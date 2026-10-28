/* =============================================================================
 * app.js - Controlador de la app "Póster en Bloques".
 *
 * Todo ocurre en el navegador. La imagen NO se sube a ningún servidor.
 * ========================================================================== */

import {
  PAPER_SIZES, defaultConfig, computeLayout, imagePlacement, tileSourceRect,
  effectiveDpi, sharpnessTier, validateSettings, estimateConsumption,
  blankSheets, sheetCoverage, stretchWarning, paperDims, mmToDimension, LIMITS,
} from './geometry.js';

import { generatePosterPDF, generateCalibrationPDF, generateTestPagePDF } from './pdf.js';

const $ = (id) => document.getElementById(id);
const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

/* ---------------------------------------------------------------- estado */
const state = {
  config: defaultConfig(),
  file: null,
  bitmap: null,
  imgW: 0,
  imgH: 0,
  imgAspect: 1,
  layout: null,
  placement: null,
  worker: null,
  jobId: 0,
  cancelled: false,
  lastSheets: null,
};

/* ================================================================ UI base */

/** Segmented control genérico. */
function wireSeg(id, onChange) {
  const root = $(id);
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.classList.contains('on')) return;
    root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    onChange(btn.dataset.v);
  });
}

/** Lee todos los inputs a la config. */
function readInputs() {
  const c = state.config;
  c.targetWidth = parseFloat($('targetW').value) || 60;
  c.targetHeight = parseFloat($('targetH').value) || 90;
  c.targetUnit = state.config.targetUnit;
  c.gridColumns = Math.max(1, parseInt($('cols').value, 10) || 1);
  c.gridRows = Math.max(0, parseInt($('rows').value, 10) || 0);
  c.autoRows = $('autoRows').checked;
  c.paperSizeId = $('paper').value;
  const m = c.margins;
  m.top = clampNum($('mTop').value, 0, 40);
  m.right = clampNum($('mRight').value, 0, 40);
  m.bottom = clampNum($('mBottom').value, 0, 40);
  m.left = clampNum($('mLeft').value, 0, 40);
  c.overlapMm = clampNum($('overlap').value, 0, LIMITS.maxOverlapMm);
  c.glueFlapMm = clampNum($('flap').value, 0, LIMITS.maxGlueFlapMm);
  c.dpi = parseInt(state.config.dpi, 10);
  c.fitMode = state.config.fitMode;
  c.printGuides = $('guides').checked;
  c.halftone = $('halftone').checked;
  c.halftonePitch = parseFloat($('htPitch').value) || 3;
  c.halftoneShape = $('htShape').value;
  if ($('paper').value === 'custom') {
    const w = parseFloat($('cw').value), h = parseFloat($('ch').value);
    c.customPaper = (w > 0 && h > 0) ? { id: 'custom', name: 'Personalizado', w, h } : null;
  } else {
    c.customPaper = null;
  }
}

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, parseFloat(v) || 0));

/* ============================================================ render preview */

function redraw() {
  readInputs();
  $('ovVal').textContent = state.config.overlapMm;
  $('flapVal').textContent = state.config.glueFlapMm;

  if (!state.bitmap) { renderEmpty(); return; }

  const c = state.config;
  const layout = computeLayout(c, state.imgAspect);
  const placement = imagePlacement(layout, state.imgAspect, c.fitMode);
  state.layout = layout;
  state.placement = placement;

  // Validación de límites ANTES de reservar memoria.
  const v = validateSettings(c, layout, isMobile);
  if (!v.ok) {
    showAlerts([{ kind: 'bad', text: v.reason }]);
    $('btnPdf').disabled = true;
    $('btnTest').disabled = true;
    renderPoster(layout, placement);
    return;
  }

  drawPreview(layout, placement);
  renderStats(layout, placement);
  renderAlerts(layout, placement);
}

function renderEmpty() {
  showBusy(false);
  showProgress(false);
  $('emptyState').classList.remove('hidden');
  $('posterWrap').classList.add('hidden');
  $('sheets').innerHTML = '';
  for (const id of ['sSheets', 'sSize', 'sDpi', 'sSharp', 'sPaper', 'sInk']) $(id).textContent = '-';
  $('btnPdf').disabled = true;
  $('btnTest').disabled = true;
  $('btnPrintAll').disabled = true;
  $('btnCalib').disabled = true;
  $('alerts').innerHTML = '';
}

/**
 * Dibuja el póster completo en CSS: cada tile es un recorte de la imagen.
 */
function drawPreview(layout, placement) {
  const poster = $('poster');
  $('emptyState').classList.add('hidden');
  $('posterWrap').classList.remove('hidden');

  // El póster se dibuja con el tamaño de la GRILLA (puede ser un poco mayor
  // que el póster pedido si el alto se redondeó).
  const maxW = 460;
  const maxH = 480;
  const scale = Math.min(maxW / layout.gridWidthMm, maxH / layout.gridHeightMm);
  const posterW = layout.gridWidthMm * scale;
  const posterH = layout.gridHeightMm * scale;

  poster.style.width = `${posterW}px`;
  poster.style.height = `${posterH}px`;
  poster.style.display = 'block';
  poster.style.gridTemplateColumns = 'none';
  poster.style.gridTemplateRows = 'none';

  const url = state.previewUrl;
  const cw = layout.contentWidthMm;
  const ch = layout.contentHeightMm;

  // La imagen se dibuja UNA SOLA VEZ, continua, en su posición dentro de la
  // grilla. Antes se pintaba la imagen COMPLETA dentro de cada celda
  // (background-size en %), por eso se veía el póster repetido en todas.
  let html = `<img class="posterImg" src="${url}" alt="Vista previa del póster" style="left:${placement.xMm * scale}px;top:${placement.yMm * scale}px;width:${placement.wMm * scale}px;height:${placement.hMm * scale}px">`;

  // Franja de solape: la banda que se pega entre hojas vecinas.
  if (layout.overlapMm > 0) {
    for (let c = 0; c < layout.columns - 1; c++) {
      html += `<div class="ovBand" style="left:${(c + 1) * layout.stepXMm * scale}px;top:0;width:${layout.overlapMm * scale}px;height:${posterH}px"></div>`;
    }
    for (let r = 0; r < layout.rows - 1; r++) {
      html += `<div class="ovBand" style="left:0;top:${(r + 1) * layout.stepYMm * scale}px;width:${posterW}px;height:${layout.overlapMm * scale}px"></div>`;
    }
  }

  // Marco y etiqueta de cada hoja: dónde va cada página impresa.
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      const t = tileSourceRect(layout, placement, state.imgW, state.imgH, r, c);
      const l = c * layout.stepXMm * scale;
      const tp = r * layout.stepYMm * scale;
      const cls = t.empty ? ' sheetFrame empty' : ' sheetFrame';
      html += `<div class="${cls.trim()}" style="left:${l}px;top:${tp}px;width:${cw * scale}px;height:${ch * scale}px"><span>R${r + 1}·C${c + 1}</span></div>`;
    }
  }
  poster.innerHTML = html;

  $('posterCap').innerHTML =
    `Póster final: <b>${(layout.posterWidthMm / 10).toFixed(1)} × ${(layout.posterHeightMm / 10).toFixed(1)} cm</b> · ` +
    `<b>${layout.totalPages} hojas</b> · ${layout.columns} de ancho × ${layout.rows} de alto`;

  // Miniaturas de las hojas: cada una con SU recorte de la imagen.
  const paper = paperDims(state.config);
  const m = state.config.margins;
  const sheetsEl = $('sheets');
  let sh = '';
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      const t = tileSourceRect(layout, placement, state.imgW, state.imgH, r, c);
      const label = `R${r + 1}·C${c + 1}`;
      const ar = `${paper.widthMm}/${paper.heightMm}`;
      if (t.empty) {
        sh += `<div class="sheet blank" style="aspect-ratio:${ar}"><span class="slbl">${label}</span></div>`;
        continue;
      }
      // Área imprimible dentro del papel (porcentaje del papel).
      const paLeft = (m.left / paper.widthMm) * 100;
      const paTop = (m.top / paper.heightMm) * 100;
      const paW = (cw / paper.widthMm) * 100;
      const paH = (ch / paper.heightMm) * 100;
      // La imagen, con origen en el área imprimible de ESTA hoja.
      const imLeft = ((placement.xMm - c * layout.stepXMm) / cw) * 100;
      const imTop = ((placement.yMm - r * layout.stepYMm) / ch) * 100;
      const imW = (placement.wMm / cw) * 100;
      const imH = (placement.hMm / ch) * 100;
      sh += `<div class="sheet" style="aspect-ratio:${ar}">
        <div class="sheetArea" style="left:${paLeft}%;top:${paTop}%;width:${paW}%;height:${paH}%">
          <img class="sheetImg" src="${url}" alt="" style="left:${imLeft}%;top:${imTop}%;width:${imW}%;height:${imH}%">
        </div>
        <span class="slbl">${label}</span>
      </div>`;
    }
  }
  sheetsEl.innerHTML = sh;
}

function renderStats(layout, placement) {
  const c = state.config;
  const dpi = effectiveDpi(state.imgW, layout);
  const sharp = sharpnessTier(dpi);
  const cons = estimateConsumption(layout, c, state.imgW, state.imgH);
  const paperName = c.customPaper ? 'Personalizado' : (PAPER_SIZES.find((p) => p.id === c.paperSizeId) || {}).name;

  $('sSheets').textContent = layout.totalPages;
  $('sSize').innerHTML = `${(layout.posterWidthMm / 10).toFixed(0)}×${(layout.posterHeightMm / 10).toFixed(0)}<small> cm</small>`;
  $('sDpi').innerHTML = `${dpi}<small> DPI</small>`;
  $('sSharp').textContent = sharp.label;
  $('stDpi').className = `stat ${dpi >= 120 ? 'good' : 'bad'}`;
  $('stSharp').className = `stat ${sharp.ok ? 'good' : 'bad'}`;
  $('sPaper').innerHTML = `${cons.sheets}<small> hojas</small>`;
  $('sInk').innerHTML = `${cons.inkGramsLow.toFixed(0)}–${cons.inkGramsHigh.toFixed(0)}<small> g</small>`;

  $('btnPdf').disabled = false;
  $('btnTest').disabled = false;
  $('btnPrintAll').disabled = false;
  $('btnCalib').disabled = false;
}

function renderAlerts(layout, placement) {
  const alerts = [];
  const c = state.config;

  const sw = stretchWarning(c, state.imgAspect);
  if (sw) {
    const dims = `${c.targetWidth}×${c.targetHeight} ${c.targetUnit === 'cm' ? 'cm' : 'pulgadas'}`;
    alerts.push(sw.mode === 'cover'
      ? {
          kind: 'warn',
          text: `Pediste un póster ${dims} pero tu imagen es de otra proporción. ` +
                `Con «Llenar» se recorta un ${sw.percent}% de la imagen para llenar el papel. ` +
                `Usa «Ajustar» para verla completa.`,
        }
      : {
          kind: 'warn',
          text: `Pediste un póster ${dims} pero tu imagen es de otra proporción. ` +
                `Con «Ajustar» la imagen NO se deforma: le sobran ${sw.percent}% de papel en blanco ` +
                `(sobran ${sw.direction === 'comprimida' ? 'a los lados' : 'arriba y abajo'}). ` +
                `Usa «Llenar» si prefieres recortarla para que llene el papel.`,
        });
  }

  const cov = sheetCoverage(layout, placement, state.imgW, state.imgH);
  const blanks = cov.filter((s) => s.coverage === 0);
  const partial = cov.filter((s) => s.coverage > 0.001 && s.coverage < 0.999);

  if (blanks.length) {
    alerts.push({
      kind: 'ok',
      text: `${blanks.length} hoja(s) saldrán EN BLANCO (${blanks.slice(0, 6).map((b) => b.label).join(', ')}` +
            `${blanks.length > 6 ? '…' : ''}). No las imprimas: ahorras papel y tinta.`,
    });
  }
  if (partial.length) {
    alerts.push({
      kind: 'ok',
      text: `${partial.length} hoja(s) de la última fila van PARCIALES (tienen imagen y papel de sobra). ` +
            `Recorta el papel sobrante al montar.`,
    });
  }

  const dpi = effectiveDpi(state.imgW, layout);
  if (dpi < 120) {
    alerts.push({
      kind: 'warn',
      text: `Tu imagen solo da ${dpi} DPI a este tamaño. Se va a ver blanda. ` +
            `Baja el número de hojas o usa una imagen más grande.`,
    });
  }

  const v = validateSettings(c, layout, isMobile);
  if (!v.ok) alerts.push({ kind: 'bad', text: v.reason });

  if (c.glueFlapMm > 0) {
    alerts.push({
      kind: 'ok',
      text: `La solapa de pegado de ${c.glueFlapMm} mm queda en blanco en el borde derecho de cada hoja. ` +
            `Corta por la línea roja y pega ahí, la imagen no se arruga.`,
    });
  }

  showAlerts(alerts);
}

function showAlerts(list) {
  const el = $('alerts');
  el.innerHTML = list.map((a) => `<div class="note ${a.kind}">${a.text}</div>`).join('');
}

/* ============================================================== carga img */

async function loadFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    showAlerts([{ kind: 'bad', text: 'Solo JPG, PNG o WebP.' }]);
    return;
  }
  state.file = file;
  $('fileName').textContent = file.name.length > 26 ? file.name.slice(0, 24) + '…' : file.name;
  $('fileInfo').classList.remove('hidden');

  try {
    // La proporción sale del bitmap REAL (ya con la orientación EXIF
    // aplicada). Nada de probes reducidos: `resizeWidth:1` redondea el alto
    // a 1 píxel y devuelve una proporción de 1.0 para cualquier imagen
    // vertical, lo que deformaba el póster y estiraba la imagen al imprimir.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    state.bitmap = bmp;
    state.imgW = bmp.width;
    state.imgH = bmp.height;
    // imgAspect = ANCHO / ALTO (así lo espera geometry.js).
    state.imgAspect = bmp.width / bmp.height;

    // URL para la vista previa (ObjectURL del File original)
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(file);

    redraw();
  } catch (err) {
    showAlerts([{ kind: 'bad', text: 'No pude leer la imagen: ' + err.message }]);
  }
}

/* ============================================================ worker/render */

/**
 * Genera los PNG de cada hoja usando el worker.
 * NUNCA crea un canvas del tamaño del póster, solo del tamaño de UNA hoja.
 */
async function renderSheets() {
  const c = state.config;
  const layout = state.layout;
  const placement = state.placement;

  const v = validateSettings(c, layout, isMobile);
  if (!v.ok) throw new Error(v.reason);

  // Píxeles de la hoja: el área de contenido a la resolución elegida.
  const widthPx = Math.round((layout.contentWidthMm / 25.4) * c.dpi);
  const heightPx = Math.round((layout.contentHeightMm / 25.4) * c.dpi);

  const sheets = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let col = 0; col < layout.columns; col++) {
      const t = tileSourceRect(layout, placement, state.imgW, state.imgH, r, col);
      sheets.push({
        row: r, col,
        widthPx, heightPx,
        rect: {
          empty: t.empty,
          dxPx: t.dxMm * (c.dpi / 25.4),
          dyPx: t.dyMm * (c.dpi / 25.4),
          dwPx: t.dwMm * (c.dpi / 25.4),
          dhPx: t.dhMm * (c.dpi / 25.4),
          sx: t.sx, sy: t.sy, sw: t.sw, sh: t.sh,
        },
      });
    }
  }

  // El worker recibe el bitmap TRANSFERIBLE (sin copiar memoria).
  const worker = new Worker('js/worker.js', { type: 'module' });
  state.worker = worker;
  state.cancelled = false;
  const jobId = ++state.jobId;

  return new Promise((resolve, reject) => {
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'progress') {
        const pct = Math.round((m.done / m.total) * 100);
        $('progMsg').textContent = `Generando hojas… ${m.done}/${m.total}`;
        $('progBar').style.width = `${pct}%`;
      } else if (m.type === 'done') {
        $('progBar').style.width = '100%';
        resolve(m.results.map((r) => ({
          row: r.row, col: r.col, buffer: r.buffer, widthPx, heightPx,
        })));
      } else if (m.type === 'error') {
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'error del worker'));

    // El worker decodifica el archivo por su cuenta: el bitmap del hilo
    // principal NO se transfiere (quedaría detached y rompería la 2ª descarga).
    worker.postMessage({ type: 'init', file: state.file });

    worker.postMessage({
      type: 'render',
      jobId,
      sheets,
      dpi: c.dpi,
      fitMode: c.fitMode,
      halftone: {
        enabled: c.halftone,
        pitchMm: c.halftonePitch,
        dpi: c.dpi,
        shape: c.halftoneShape,
      },
    });
  });
}

/* ================================================================ acciones */

function showProgress(on, msg) {
  $('progress').classList.toggle('hidden', !on);
  if (msg) $('progMsg').textContent = msg;
  if (on) $('progBar').style.width = '0%';
}

function showBusy(on, msg) {
  $('busy').classList.toggle('hidden', !on);
  if (msg) $('busyMsg').textContent = msg;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function doPosterPDF() {
  if (!state.bitmap) return;
  try {
    showProgress(true, 'Generando hojas…');
    const sheets = await renderSheets();
    showProgress(true, 'Armando el PDF…');
    const paperName = state.config.customPaper ? 'Personalizado'
      : (PAPER_SIZES.find((p) => p.id === state.config.paperSizeId) || {}).name;
    const blob = await generatePosterPDF(state.layout, sheets, state.config, {
      paperName,
      title: `Poster ${state.layout.columns}x${state.layout.rows}`,
    });
    download(blob, `poster-${state.layout.columns}x${state.layout.rows}.pdf`);
  } catch (err) {
    showAlerts([{ kind: 'bad', text: 'No pude generar el PDF: ' + err.message }]);
  } finally {
    showProgress(false);
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    // El bitmap se consumió (transferido). Hay que re-decodificar para poder
    // volver a generar.
    await refreshBitmap();
  }
}

async function doTestPage() {
  if (!state.bitmap) return;
  try {
    showProgress(true, 'Generando hoja de prueba…');
    const sheets = await renderSheets();
    showProgress(true, 'Armando el PDF…');
    const blob = await generateTestPagePDF(state.layout, state.config, sheets[0]);
    download(blob, 'poster-hoja-de-prueba.pdf');
  } catch (err) {
    showAlerts([{ kind: 'bad', text: 'No pude generar la hoja de prueba: ' + err.message }]);
  } finally {
    showProgress(false);
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    await refreshBitmap();
  }
}

async function doPrintIndividualSheets() {
  if (!state.bitmap) return;
  try {
    showProgress(true, 'Generando hojas para imprimir…');
    const sheets = await renderSheets();
    const w = window.open('', '_blank');
    if (!w) {
      showAlerts([{ kind: 'warn', text: 'El navegador bloqueó la ventana emergente. Permite ventanas emergentes para este sitio.' }]);
      return;
    }

    const layout = state.layout;
    const isLandscape = state.config.orientation === 'landscape';
    const pw = layout.paperWidthMm;
    const ph = layout.paperHeightMm;

    // Convertir cada buffer PNG a URL de objeto
    const imgUrls = sheets.map((s) => {
      const blob = new Blob([s.buffer], { type: 'image/png' });
      return URL.createObjectURL(blob);
    });

    // Construir documento imprimible: cada hoja = página separada A4
    let pagesHtml = '';
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      const label = `R${s.row + 1}·C${s.col + 1}`;
      pagesHtml += `<div class="sheet-page">
        <div class="sheet-label">${label}</div>
        <img src="${imgUrls[i]}" alt="Hoja ${label}" />
      </div>`;
    }

    w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
    <title>Imprimir hojas — Póster ${layout.columns}x${layout.rows}</title>
    <style>
      @page { size: ${pw}mm ${ph}mm; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; }
      .sheet-page { width: ${pw}mm; height: ${ph}mm; page-break-after: always; padding: 8mm; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; }
      .sheet-label { font-size: 14pt; font-weight: 700; color: #0d5b7d; margin-bottom: 4mm; letter-spacing: 0.5pt; }
      .sheet-page img { max-width: ${pw - 16}mm; max-height: ${ph - 30}mm; object-fit: contain; border: 1pt solid #ddd; page-break-inside: avoid; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style></head><body>
    ${pagesHtml}
    </body></html>`);
    w.document.close();

    // Esperar a que carguen las imágenes antes de llamar a print
    setTimeout(() => w.print(), 600);
  } catch (err) {
    showAlerts([{ kind: 'bad', text: 'No pude abrir la impresión: ' + err.message }]);
  } finally {
    showProgress(false);
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    await refreshBitmap();
  }
}

async function doCalibration() {
  try {
    showBusy(true, 'Generando la hoja de calibración…');
    const blob = await generateCalibrationPDF(state.layout || computeLayout(state.config, state.imgAspect || 1));
    download(blob, 'poster-calibracion.pdf');
  } catch (err) {
    showAlerts([{ kind: 'bad', text: 'No pude generar la calibración: ' + err.message }]);
  } finally {
    showBusy(false);
  }
}

function doGuide() {
  const w = window.open('', '_blank');
  if (!w) { showAlerts([{ kind: 'warn', text: 'El navegador bloqueó la ventana. Permite las ventanas emergentes para este sitio.' }]); return; }
  const L = state.layout;
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Guía de montaje</title>
<style>body{font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  max-width:720px;margin:0 auto;padding:32px 20px;color:#1c232c;background:#fff}
h1{font-size:24px;margin-bottom:6px}h2{font-size:17px;margin-top:28px;color:#0d5b7d}
.box{background:#f2f7fa;border-left:3px solid #4ec3f7;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0}
ol{padding-left:22px}li{margin-bottom:10px}
table{border-collapse:collapse;width:100%;margin:12px 0}
td,th{border:1px solid #d5dde4;padding:7px 10px;text-align:left;font-size:14px}
th{background:#f2f5f8}</style></head><body>
<h1>🧭 Cómo armar tu póster</h1>
${L ? `<div class="box"><b>Tu póster:</b> ${(L.posterWidthMm / 10).toFixed(1)} × ${(L.posterHeightMm / 10).toFixed(1)} cm ·
<b>${L.totalPages} hojas</b> (${L.columns} de ancho × ${L.rows} de alto)</div>` : ''}
<h2>Materiales</h2>
<ul>
<li>Hojas ${L ? (L.totalPages) : ''} de papel A4 o del tamaño que usaste</li>
<li>Cúter o tijeras con filo recto, y una regla metálica</li>
<li>Cinta de pintor o cinta doble faz (no cinta transparente)</li>
<li>Una superficie grande y plana para armar (mesa, piso)</li>
</ul>
<h2>Paso a paso</h2>
<ol>
<li><b>Imprime a escala 100%</b> (tamaño real). En el diálogo de impresión busca "Tamaño real" o "100%".
Nunca "Ajustar a la página": redimensiona cada hoja y las piezas no encajan.</li>
<li><b>Imprime una hoja primero</b> y comprueba la escala y el color. Better safe than sorry: una hoja
de prueba vale más que 12 erradas.</li>
<li><b>Recorta</b> por las marcas de corte (las rayitas en las esquinas). <b>No</b> cortes la línea
azul punteada: esa marca dónde termina la zona de solape.</li>
<li><b>Coloca las hojas boca abajo</b> sobre la mesa, en orden de lectura (R1·C1 arriba a la izquierda).</li>
<li><b>Alinea</b> usando las etiquetas R·C y las cruces de registro. Las cruces deben caer
exactamente una sobre otra.</li>
<li><b>Pega por detrás</b> con la cinta, sobre la franja de solape. Nunca pegues por delante.</li>
<li><b>Da la vuelta.</b> Las uniones se ven casi invisibles desde la distancia.</li>
</ol>
<h2>Consejos</h2>
<div class="box">
<ul>
<li>Papel de 120–160 g/m² se ve mejor y no se transparenta tanto.</li>
<li>Si una hoja quedó desalineada por un milímetro, raspa un poco el borde blanco con el cúter.</li>
<li>Si el papel se encoge al secar la cinta, usa un block de papel (cartulina) pegado detrás
con adhesivo en spray.</li>
<li>Para Majority Print con líneas muy finas, sube a 600 DPI.</li>
</ul>
</div>
<h2>Si algo salió mal</h2>
<table>
<tr><th>Síntoma</th><th>Causa</th><th>Qué hacer</th></tr>
<tr><td>Las hojas no encajan</td><td>Imprimiste a "ajustar"</td><td>Reimprime a 100%</td></tr>
<tr><td>Las piezas quedaron con huecos blancos</td><td>Margen mayor que tu impresora</td><td>Baja el margen o imprime la calibración</td></tr>
<tr><td>La imagen salió deformada</td><td>Pediste un tamaño con otra proporción</td><td>Usa "Llenar" o un tamaño con la proporción de tu imagen</td></tr>
<tr><td>El color se ve apagado</td><td>Impresión en economy</td><td>Cambia a calidad "Normal" o "Foto"</td></tr>
</table>
</body></html>`);
  w.document.close();
}

/** Re-decodea el bitmap (se consumió al transferirse al worker). */
async function refreshBitmap() {
  if (!state.file) return;
  try {
    state.bitmap = await createImageBitmap(state.file, { imageOrientation: 'from-image' });
  } catch { /* si falla, el usuario tendrá que recargar la imagen */ }
}

/* ================================================================== init */

function init() {
  // Papeles
  const sel = $('paper');
  sel.innerHTML = PAPER_SIZES.map((p) =>
    `<option value="${p.id}">${p.name} (${p.w} × ${p.h} mm)</option>`).join('')
    + '<option value="custom">Personalizado…</option>';

  // Eventos de la interfaz
  $('drop').addEventListener('click', () => $('file').click());
  $('btnChange').addEventListener('click', (e) => { e.stopPropagation(); $('file').click(); });
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  wireSeg('segSizing', (v) => {
    state.config.sizingMode = v;
    $('exactBox').classList.toggle('hidden', v !== 'exact');
    $('gridBox').classList.toggle('hidden', v === 'exact');
    $('hintSizing').textContent = v === 'exact'
      ? 'Dime el tamaño que quieres y calculo cuántas hojas hacen falta.'
      : 'Elige cuántas hojas de ancho. El alto sale de la proporción de tu imagen.';
    redraw();
  });

  wireSeg('segUnit', (v) => { state.config.targetUnit = v; redraw(); });
  wireSeg('segOrient', (v) => { state.config.orientation = v; redraw(); });
  wireSeg('segDpi', (v) => { state.config.dpi = parseInt(v, 10); redraw(); });
  wireSeg('segFit', (v) => { state.config.fitMode = v; redraw(); });

  $('paper').addEventListener('change', () => {
    $('customPaper').classList.toggle('hidden', $('paper').value !== 'custom');
    redraw();
  });

  ['targetW', 'targetH', 'cols', 'rows', 'mTop', 'mRight', 'mBottom', 'mLeft',
    'overlap', 'flap', 'cw', 'ch', 'htPitch', 'htShape'].forEach((id) => {
    $(id).addEventListener('input', redraw);
    $(id).addEventListener('change', redraw);
  });

  $('autoRows').addEventListener('change', () => {
    $('rows').disabled = $('autoRows').checked;
    redraw();
  });
  $('guides').addEventListener('change', redraw);
  $('halftone').addEventListener('change', () => {
    $('halftoneBox').classList.toggle('hidden', !$('halftone').checked);
    redraw();
  });

  $('btnPdf').addEventListener('click', doPosterPDF);
  $('btnTest').addEventListener('click', doTestPage);
  $('btnPrintAll').addEventListener('click', doPrintIndividualSheets);
  $('btnCalib').addEventListener('click', doCalibration);
  $('btnGuide').addEventListener('click', doGuide);
  $('btnCancel').addEventListener('click', () => {
    state.cancelled = true;
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    showProgress(false);
    refreshBitmap();
  });

  showBusy(false);
  showProgress(false);

  renderEmpty();
}

init();

// Expuesto para los tests headless.
window.__poster = {
  state,
  computeLayout,
  imagePlacement,
  tileSourceRect,
  effectiveDpi,
  loadFile,
  redraw,
};
