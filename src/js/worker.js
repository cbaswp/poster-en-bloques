/* =============================================================================
 * worker.js — Render de las hojas del póster FUERA del hilo principal.
 *
 * REGLA DE ORO: nunca se crea un canvas del tamaño del PÓSTER, solo del
 * tamaño de UNA hoja. Así el pico de memoria es constante por muchas hojas
 * que tenga el póster.
 *
 * La imagen viaja como ImageBitmap TRANSFERIBLE (postMessage con transfer
 * list), que mueve la memoria de píxeles decodificados entre hilos SIN
 * COPIAR. Mandar un Uint8ClampedArray la copiaría.
 * ========================================================================== */

/* eslint-env worker */

// Recibe el bitmap y el estado ya "horneado" (LUT de 256 bytes, etc.).
let sourceBitmap = null;
// Barrier de inicialización: el handler es async, así que el mensaje
// 'render' puede ejecutarse ANTES de que termine el await de 'init'.
// Sin esta promesa, sourceBitmap seguía en null y drawImage fallaba.
let ready = Promise.resolve();

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      // El worker DECODIFICA su propia copia del archivo. Si transfiriéramos
      // el ImageBitmap del hilo principal, quedaría "detached" y la segunda
      // descarga de PDF fallaría con DataCloneError.
      ready = createImageBitmap(msg.file).then((bmp) => {
        sourceBitmap = bmp;
        self.postMessage({ type: 'ready' });
      });
      await ready;
      return;
    }

    if (msg.type === 'render') {
      // Esperar a que la decodificación termine antes de dibujar.
      await ready;

      const { jobId, sheets, dpi, fitMode, halftone } = msg;
      const results = [];

      for (const sheet of sheets) {
        // Allow the main thread to paint progress and honour cancel.
        await new Promise((r) => setTimeout(r, 0));

        const buf = await renderSheet(sheet, dpi, fitMode, halftone);
        results.push({ row: sheet.row, col: sheet.col, buffer: buf });

        self.postMessage({
          type: 'progress',
          jobId,
          done: results.length,
          total: sheets.length,
        });
      }

      self.postMessage({ type: 'done', jobId, results }, transferablesOf(results));
      return;
    }

    if (msg.type === 'cancel') {
      // The main thread simply stops listening; we abort by not continuing.
      self.postMessage({ type: 'cancelled' });
      return;
    }

    if (msg.type === 'dispose') {
      if (sourceBitmap) {
        sourceBitmap.close();
        sourceBitmap = null;
      }
      self.postMessage({ type: 'disposed' });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};

function transferablesOf(results) {
  return results.map((r) => r.buffer).filter(Boolean);
}

/**
 * Renderiza UNA hoja a un canvas OffscreenCanvas y devuelve un ArrayBuffer
 * con el PNG codificado.
 */
async function renderSheet(sheet, dpi, fitMode, halftone) {
  const { widthPx, heightPx, rect } = sheet;

  if (rect.empty) {
    // Hoja en blanco: se genera un PNG 1x1 blanco que el PDF estira.
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blob.arrayBuffer();
  }

  const canvas = new OffscreenCanvas(widthPx, heightPx);
  // willReadFrequently EXIGE un booleano: pasarle el objeto de medio tono
  // lanzaba TypeError y mataba la generación del PDF entero.
  const ctx = canvas.getContext('2d', { willReadFrequently: !!(halftone && halftone.enabled) });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  // El recorte se hace con drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh):
  // solo se dibuja la porción de la fuente que corresponde a esta hoja.
  const dx = Math.round(rect.dxPx);
  const dy = Math.round(rect.dyPx);
  const dw = Math.round(rect.dwPx);
  const dh = Math.round(rect.dhPx);

  if (halftone && halftone.enabled) {
    await drawHalftone(ctx, sourceBitmap, rect, widthPx, heightPx, halftone);
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      sourceBitmap,
      rect.sx, rect.sy, rect.sw, rect.sh,
      dx, dy, dw, dh
    );
  }

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await blob.arrayBuffer();
}

/**
 * Medio tono: convierte la imagen en puntos de tamaño variable.
 *
 * Luminancia relativa (Rec.709): 0.2126R + 0.7152G + 0.0722B.
 * El radio del punto crece con la luminosidad (los oscuros, más grandes).
 *
 * Se dibujan como vectores sobre el canvas: quedan nítidos a cualquier
 * resolución de impresión.
 */
async function drawHalftone(ctx, bitmap, rect, widthPx, heightPx, halftone) {
  const pitchPx = Math.max(2, (halftone.pitchMm / 25.4) * halftone.dpi);

  // Muestreo: leemos la región de la fuente a resolución de celda, no completa.
  const cols = Math.max(1, Math.ceil(rect.dwPx / pitchPx));
  const rows = Math.max(1, Math.ceil(rect.dhPx / pitchPx));

  const sampleCanvas = new OffscreenCanvas(cols, rows);
  const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(
    bitmap,
    rect.sx, rect.sy, rect.sw, rect.sh,
    0, 0, cols, rows
  );
  const data = sctx.getImageData(0, 0, cols, rows).data;

  const maxR = pitchPx * 0.52;
  const minR = pitchPx * 0.08;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.dxPx, rect.dyPx, rect.dwPx, rect.dhPx);
  ctx.clip();

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const i = (ry * cols + rx) * 4;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const brightness = 1 - lum;
      const r = minR + brightness * (maxR - minR);
      if (r <= 0.35) continue;

      const cx = rect.dxPx + (rx + 0.5) * pitchPx;
      const cy = rect.dyPx + (ry + 0.5) * pitchPx;

      if (halftone.shape === 'square') {
        ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
