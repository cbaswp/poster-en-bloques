/* =============================================================================
 * pdf.js — Generación del PDF multipágina del póster.
 *
 * Usa @cantoo/pdf-lib 2.11.1 (fork vivo de pdf-lib; el upstream está
 * abandonado desde 2021). Mismo API, bundle local, sin CDN.
 *
 * TODO el PDF se arma en PUNTOS, pero los cálculos vienen en mm desde
 * geometry.js. La conversión ocurre SOLO aquí.
 * ========================================================================== */

import { mmToPt, PAPER_BY_ID } from './geometry.js';

const PDFLib = globalThis.PDFLib;

/* Colores de las guías (0..1). */
const C = {
  accent: rgb(0.90, 0.22, 0.27),
  gray: rgb(0.40, 0.40, 0.45),
  light: rgb(0.82, 0.82, 0.86),
  overlap: rgb(0.13, 0.42, 0.75),
  ink: rgb(0.10, 0.10, 0.18),
};

function rgb(r, g, b) {
  return PDFLib.rgb(r, g, b);
}

/**
 * Genera el PDF completo del póster.
 *
 * @param {object} layout     resultado de computeLayout()
 * @param {Array}  sheets     [{row, col, buffer}] con el PNG de cada hoja
 * @param {object} config
 * @param {object} extras     {instructions, assemblyMap, paperName, posterLabel}
 * @returns {Promise<Blob>}
 */
export async function generatePosterPDF(layout, sheets, config, extras = {}) {
  const doc = await PDFLib.PDFDocument.create();

  const pw = mmToPt(layout.paperWidthMm);
  const ph = mmToPt(layout.paperHeightMm);
  const m = mmToPt(layout.margins.top);
  const ml = mmToPt(layout.margins.left);
  const mr = mmToPt(layout.margins.right);
  const mb = mmToPt(layout.margins.bottom);

  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  // --- Hoja 1: mapa de montaje + instrucciones -------------------------
  if (extras.assemblyMap !== false) {
    await drawAssemblyMap(doc, layout, config, font, bold, extras);
  }

  // --- Hojas del póster ------------------------------------------------
  const ordered = [...sheets].sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

  for (const sheet of ordered) {
    const page = doc.addPage([pw, ph]);

    // Marco del área imprimible (la "caja" donde va la imagen).
    const contentX = ml;
    const contentY = ph - mmToPt(layout.margins.top) - mmToPt(layout.contentHeightMm);
    const contentW = mmToPt(layout.contentWidthMm);
    const contentH = mmToPt(layout.contentHeightMm);

    if (sheet.buffer) {
      const png = await doc.embedPng(sheet.buffer);
      // La imagen ya viene del worker con el recorte y el offset correctos,
      // en píxeles. Se dibuja 1:1 en el área de contenido.
      const scale = Math.min(contentW / sheet.widthPx, contentH / sheet.heightPx);
      const drawW = sheet.widthPx * scale;
      const drawH = sheet.heightPx * scale;
      const offX = contentX + (contentW - drawW) / 2;
      const offY = contentY + (contentH - drawH) / 2;
      page.drawImage(png, { x: offX, y: offY, width: drawW, height: drawH });
    } else {
      page.drawRectangle({
        x: contentX, y: contentY, width: contentW, height: contentH,
        color: rgb(0.97, 0.97, 0.98),
        borderColor: C.light,
        borderWidth: 0.5,
      });
      page.drawText('HOJA EN BLANCO', {
        x: contentX + contentW / 2 - 32,
        y: contentY + contentH / 2,
        size: 9,
        font: bold,
        color: C.gray,
      });
    }

    if (config.printGuides) {
      drawPrintGuides(page, layout, sheet, font, bold, { contentX, contentY, contentW, contentH });
    }
  }

  // Metadatos
  doc.setTitle(extras.title || `Poster ${layout.columns}x${layout.rows}`);
  doc.setSubject('Block poster generado en el navegador');
  doc.setProducer('Poster en Bloques');

  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Marcas de corte, marcas de registro, línea de solapamiento y etiqueta.
 */
function drawPrintGuides(page, layout, sheet, font, bold, box) {
  const { contentX, contentY, contentW, contentH } = box;

  // --- Marcas de corte en las 4 esquinas del área imprimible ------------
  const u = Math.min(mmToPt(6), Math.max(6, 0.8 * mmToPt(layout.margins.left)));
  const gap = Math.min(3, 0.2 * mmToPt(layout.margins.left));

  const line = (x1, y1, x2, y2, color = C.gray, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });

  // superior izquierda
  line(contentX - u, contentY + contentH, contentX - gap, contentY + contentH);
  line(contentX, contentY + contentH + u, contentX, contentY + contentH + gap);
  // superior derecha
  line(contentX + contentW + gap, contentY + contentH, contentX + contentW + u, contentY + contentH);
  line(contentX + contentW, contentY + contentH + u, contentX + contentW, contentY + contentH + gap);
  // inferior izquierda
  line(contentX - u, contentY, contentX - gap, contentY);
  line(contentX, contentY - gap, contentX, contentY - u);
  // inferior derecha
  line(contentX + contentW + gap, contentY, contentX + contentW + u, contentY);
  line(contentX + contentW, contentY - gap, contentX + contentW, contentY - u);

  // --- Marcas de registro (cruz) en las 4 esquinas ----------------------
  const h = Math.min(mmToPt(3), 8);
  const corners = [
    { x: contentX, y: contentY + contentH },
    { x: contentX + contentW, y: contentY + contentH },
    { x: contentX, y: contentY },
    { x: contentX + contentW, y: contentY },
  ];
  for (const c of corners) {
    line(c.x - h, c.y, c.x + h, c.y, C.accent, 0.45);
    line(c.x, c.y - h, c.x, c.y + h, C.accent, 0.45);
  }

  // --- Línea de solapamiento (punteada) --------------------------------
  const p = mmToPt(layout.overlapMm);
  if (layout.overlapMm > 0) {
    if (sheet.col < layout.columns - 1 && p < contentW) {
      const x = contentX + contentW - p;
      page.drawLine({
        start: { x, y: contentY },
        end: { x, y: contentY + contentH },
        thickness: 0.6,
        color: C.overlap,
        dashArray: [4, 3],
      });
      page.drawText('solape', {
        x: x + 3, y: contentY + contentH - 8, size: 7, font, color: C.overlap,
      });
    }
    if (sheet.row < layout.rows - 1 && p < contentH) {
      const y = contentY + p;
      page.drawLine({
        start: { x: contentX, y },
        end: { x: contentX + contentW, y },
        thickness: 0.6,
        color: C.overlap,
        dashArray: [4, 3],
      });
      page.drawText('solape', {
        x: contentX + 4, y: y + 3, size: 7, font, color: C.overlap,
      });
    }
  }

  // --- Línea de corte de la solapa de pegado (blanco) -------------------
  if (layout.glueFlapMm > 0) {
    const fx = contentX + contentW;
    page.drawLine({
      start: { x: fx, y: contentY },
      end: { x: fx, y: contentY + contentH },
      thickness: 0.6,
      color: C.accent,
      dashArray: [2, 2],
    });
    page.drawText('cortar', {
      x: fx + 3, y: contentY + 6, size: 6.5, font, color: C.accent,
    });
  }

  // --- Etiqueta de posición --------------------------------------------
  const label = `R${sheet.row + 1}·C${sheet.col + 1}`;
  page.drawText(label, {
    x: contentX + 4,
    y: contentY + contentH - 12,
    size: 9,
    font: bold,
    color: C.ink,
  });
}

/**
 * Primera página: mapa de montaje + instrucciones.
 */
async function drawAssemblyMap(doc, layout, config, font, bold, extras) {
  const pw = mmToPt(layout.paperWidthMm);
  const ph = mmToPt(layout.paperHeightMm);
  const page = doc.addPage([pw, ph]);

  const m = mmToPt(14);
  let y = ph - m;

  page.drawText('Cómo armar tu póster', {
    x: m, y, size: 17, font: bold, color: C.ink,
  });
  y -= 24;

  const cm = (mm) => (mm / 10).toFixed(1);
  const info = [
    `Póster final: ${cm(layout.posterWidthMm)} × ${cm(layout.posterHeightMm)} cm`,
    `Hojas: ${layout.totalPages} (${layout.columns} de ancho × ${layout.rows} de alto)`,
    `Papel: ${extras.paperName || 'A4'}`,
    `Solapamiento: ${layout.overlapMm} mm`,
  ];
  for (const line of info) {
    page.drawText(line, { x: m, y, size: 10, font, color: C.gray });
    y -= 15;
  }
  y -= 10;

  // --- Miniatura de la grilla ------------------------------------------
  const maxW = pw - m * 2;
  const maxH = ph * 0.42;
  const cellW = Math.min(maxW / layout.columns, maxH / layout.rows);
  const gridW = cellW * layout.columns;
  const gridH = cellW * layout.rows;
  const gx = (pw - gridW) / 2;
  const gy = y - gridH;

  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      const cx = gx + c * cellW;
      const cy = gy + (layout.rows - 1 - r) * cellW;
      const isLastCol = c === layout.columns - 1;
      const isLastRow = r === layout.rows - 1;
      page.drawRectangle({
        x: cx, y: cy, width: cellW, height: cellW,
        color: rgb(0.96, 0.96, 0.97),
        borderColor: C.light,
        borderWidth: 0.5,
      });
      const label = `${String.fromCharCode(65 + r)}${c + 1}`;
      page.drawText(label, {
        x: cx + cellW / 2 - 6,
        y: cy + cellW / 2 - 3,
        size: 9,
        font: bold,
        color: C.gray,
      });
      // Marca las hojas de la última fila/columna
      if (isLastCol || isLastRow) {
        page.drawRectangle({
          x: cx, y: cy, width: cellW, height: cellW,
          borderColor: C.accent,
          borderWidth: 0.8,
        });
      }
    }
  }
  y = gy - 22;

  page.drawText('El borde rojo marca la última fila y columna: recórtalas si sobran.', {
    x: m, y, size: 8.5, font, color: C.accent,
  });
  y -= 20;

  // --- Instrucciones ----------------------------------------------------
  const steps = [
    '1. Imprime TODO a escala 100% (tamaño real). Nunca uses «Ajustar a la página».',
    '2. Recorta por las marcas de corte, sin tocar la línea punteada azul.',
    '3. Alinea las hojas usando la etiqueta R·C y las cruces de registro.',
    '4. Pega por DETRÁS con cinta, sobre la franja de solape.',
    '5. Da la vuelta y ya está tu póster.',
  ];
  for (const s of steps) {
    page.drawText(s, { x: m, y, size: 9.5, font, color: C.ink });
    y -= 14;
  }

  y -= 8;
  const notes = [
    'Si el papel se encoge al pegar, usa el block de papel en vez de cinta.',
    'Imprime UNA hoja de prueba antes de sacar las 12.',
  ];
  for (const n of notes) {
    page.drawText(n, { x: m, y, size: 8.5, font, color: C.gray });
    y -= 12;
  }
}

/**
 * PDF de calibración: mide cuánto escala tu impresora.
 * Imprime esta hoja, mide con una regla la distancia entre dos rayas y
 * eso te dice si tu impresora agranda o achica (y cuánto).
 */
export async function generateCalibrationPDF(layout) {
  const doc = await PDFLib.PDFDocument.create();
  const pw = mmToPt(layout.paperWidthMm);
  const ph = mmToPt(layout.paperHeightMm);
  const page = doc.addPage([pw, ph]);

  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  page.drawText('Calibración de impresora', {
    x: mmToPt(14), y: ph - mmToPt(16), size: 15, font: bold, color: C.ink,
  });
  page.drawText('Imprime a escala 100%. Mide con una regla y anota el resultado.', {
    x: mmToPt(14), y: ph - mmToPt(26), size: 9, font, color: C.gray,
  });

  // Barra de 100 mm de referencia
  const x0 = mmToPt(20);
  const y0 = ph - mmToPt(50);
  page.drawLine({
    start: { x: x0, y: y0 }, end: { x: x0 + mmToPt(100), y: y0 },
    thickness: 1.2, color: C.ink,
  });
  for (let mm = 0; mm <= 100; mm += 10) {
    const x = x0 + mmToPt(mm);
    const h = mm % 50 === 0 ? 7 : 4;
    page.drawLine({
      start: { x, y: y0 - h }, end: { x, y: y0 + h },
      thickness: mm % 50 === 0 ? 1 : 0.6, color: C.ink,
    });
    if (mm % 20 === 0) {
      page.drawText(String(mm), { x: x - 4, y: y0 - 18, size: 7, font, color: C.gray });
    }
  }
  page.drawText('0', { x: x0 - 2, y: y0 - 18, size: 7, font, color: C.gray });
  page.drawText('100 mm', {
    x: x0 + mmToPt(100) - 12, y: y0 - 32, size: 8, font: bold, color: C.accent,
  });

  // Cuadrícula de 10 mm
  const gx = mmToPt(20);
  const gy = mmToPt(40);
  const gw = mmToPt(Math.min(160, layout.paperWidthMm - 40));
  const gh = mmToPt(Math.min(120, layout.paperHeightMm - 110));
  for (let mm = 0; mm <= gw; mm += 10) {
    page.drawLine({
      start: { x: gx + mmToPt(mm), y: gy },
      end: { x: gx + mmToPt(mm), y: gy + gh },
      thickness: 0.35, color: C.light,
    });
  }
  for (let mm = 0; mm <= gh; mm += 10) {
    page.drawLine({
      start: { x: gx, y: gy + mmToPt(mm) },
      end: { x: gx + gw, y: gy + mmToPt(mm) },
      thickness: 0.35, color: C.light,
    });
  }
  page.drawRectangle({
    x: gx, y: gy, width: gw, height: gh,
    borderColor: C.accent, borderWidth: 0.8,
  });
  page.drawText(`Caja de ${Math.round(gw / (72 / 25.4))} × ${Math.round(gh / (72 / 25.4))} mm`, {
    x: gx, y: gy - 16, size: 8, font: bold, color: C.accent,
  });

  page.drawText(
    'Si al medir da más de 100 mm, tu impresora agranda: baja el margen. Si da menos, agranda el margen.',
    { x: mmToPt(14), y: mmToPt(26), size: 8.5, font, color: C.gray }
  );

  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * PDF con UNA sola hoja: para probar la escala antes de gastarte el papel.
 */
export async function generateTestPagePDF(layout, config, sheet, paperName) {
  const doc = await PDFLib.PDFDocument.create();
  const pw = mmToPt(layout.paperWidthMm);
  const ph = mmToPt(layout.paperHeightMm);
  const page = doc.addPage([pw, ph]);

  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);

  const ml = mmToPt(layout.margins.left);
  const mTop = mmToPt(layout.margins.top);
  const contentW = mmToPt(layout.contentWidthMm);
  const contentH = mmToPt(layout.contentHeightMm);
  const contentX = ml;
  const contentY = ph - mTop - contentH;

  if (sheet && sheet.buffer) {
    const png = await doc.embedPng(sheet.buffer);
    const scale = Math.min(contentW / sheet.widthPx, contentH / sheet.heightPx);
    const drawW = sheet.widthPx * scale;
    const drawH = sheet.heightPx * scale;
    page.drawImage(png, {
      x: contentX + (contentW - drawW) / 2,
      y: contentY + (contentH - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }

  if (config.printGuides) {
    drawPrintGuides(page, layout, sheet, font, bold, { contentX, contentY, contentW, contentH });
  }

  page.drawText('HOJA DE PRUEBA — mide antes de imprimir todo', {
    x: mmToPt(14), y: mmToPt(16), size: 9, font: bold, color: C.accent,
  });

  const bytes = await doc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
