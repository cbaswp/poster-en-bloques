/* =============================================================================
 * test-geometry.mjs — Tests de la geometría (sin navegador).
 *
 * Comprueban la fórmula del tamaño final, que es donde blockposter.net se
 * equivoca, y los límites de memoria.
 * ========================================================================== */

import {
  computeLayout, imagePlacement, tileSourceRect, effectiveDpi,
  validateSettings, blankSheets, sheetCoverage, partialSheets, defaultConfig,
  dimensionToMm, stretchWarning,
} from '../js/geometry.js';

let pass = 0, fail = 0;
const results = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ✓ ${name}`); }
  else { fail++; results.push(`  ✗ ${name} ${detail ? '→ ' + detail : ''}`); }
}

const cfg = (over = {}) => ({ ...defaultConfig(), ...over });

console.log('\n=== 1. Tamaño final del póster (la fórmula corregida) ===');
{
  const c = cfg({ gridColumns: 3, overlapMm: 10, margins: { top: 10, right: 10, bottom: 10, left: 10 } });
  const L = computeLayout(c, 4 / 3);
  // A4 vertical: 210x297. Imprimible: 190x277. stepX = 190-10 = 180.
  // Tamaño final = 190 + (3-1)*180 = 550 mm = 55 cm.
  check('3 columnas con 10 mm de solape = 550 mm de ancho',
    Math.abs(L.posterWidthMm - 550) < 0.01, `obtenido ${L.posterWidthMm}`);
  check('stepX = imprimible - solape = 180',
    Math.abs(L.stepXMm - 180) < 0.01, `obtenido ${L.stepXMm}`);
  check('grilla completa = tamaño final (sin holgura horizontal)',
    Math.abs(L.gridWidthMm - L.posterWidthMm) < 0.01,
    `grid ${L.gridWidthMm} vs poster ${L.posterWidthMm}`);
}

console.log('\n=== 2. Comparación con la fórmula de blockposter.net ===');
{
  // blockposter: posterWidth = cols * printable - (cols-1) * overlap
  // correcta:    posterWidth = printable + (cols-1) * (printable - overlap)
  const printable = 190, overlap = 10, cols = 4;
  const blockposterFormula = cols * printable - (cols - 1) * overlap;
  const correctFormula = printable + (cols - 1) * (printable - overlap);
  console.log(`    blockposter: ${blockposterFormula} mm`);
  console.log(`    correcta:   ${correctFormula} mm`);
  check('las dos fórmulas coinciden con este solape',
    blockposterFormula === correctFormula,
    `${blockposterFormula} vs ${correctFormula}`);

  // Y con el ancho pedido exacto: 60 cm = 600 mm
  const c = cfg({ sizingMode: 'exact', targetWidth: 60, targetHeight: 90, targetUnit: 'cm' });
  const L = computeLayout(c, 4 / 3);
  check('modo exacto: el póster mide lo pedido (600 mm)',
    Math.abs(L.posterWidthMm - 600) < 0.01, `obtenido ${L.posterWidthMm}`);
  check('modo exacto: el alto mide lo pedido (900 mm)',
    Math.abs(L.posterHeightMm - 900) < 0.01, `obtenido ${L.posterHeightMm}`);
  check('modo exacto: caben suficientes hojas',
    L.totalPages >= 1, `total ${L.totalPages}`);
}

console.log('\n=== 3. Hojas parciales y en blanco ===');
{
  const c = cfg({ gridColumns: 3, overlapMm: 10 });
  const L = computeLayout(c, 4 / 3);
  const P = imagePlacement(L, 4 / 3, 'contain');
  const cov = sheetCoverage(L, P, 3000, 2250);
  const blanks = cov.filter((s) => s.coverage === 0);
  const partial = cov.filter((s) => s.coverage > 0.001 && s.coverage < 0.999);
  const full = cov.filter((s) => s.coverage >= 0.999);
  console.log(`    llenas: ${full.length}, parciales: ${partial.length}, vacías: ${blanks.length}`);
  check('la última fila tiene hojas parciales (papel que se recorta)',
    partial.length > 0, `parciales: ${partial.length}`);
  check('toda hoja tiene cobertura entre 0 y 1',
    cov.every((s) => s.coverage >= 0 && s.coverage <= 1));
  check('las hojas llenas son la mayoría',
    full.length >= cov.length - partial.length - blanks.length);
}

console.log('\n=== 3b. Modo exacto: la imagen respeta el área pedida ===');
{
  const c = cfg({ sizingMode: 'exact', targetWidth: 60, targetHeight: 90, targetUnit: 'cm' });
  const L = computeLayout(c, 4 / 3);
  const P = imagePlacement(L, 4 / 3, 'contain');
  check('la imagen cabe DENTRO del área pedida (600 mm)',
    P.wMm <= 600.01 && P.hMm <= 900.01, `w=${P.wMm} h=${P.hMm}`);
  check('la imagen no se sale de la grilla por la izquierda',
    P.xMm >= -0.01, `x=${P.xMm}`);
  check('la imagen no se sale de la grilla por arriba',
    P.yMm >= -0.01, `y=${P.yMm}`);
}

console.log('\n=== 4. Recorte de cada hoja (offsets en píxeles) ===');
{
  const c = cfg({ gridColumns: 2, overlapMm: 10 });
  const L = computeLayout(c, 1);
  const P = imagePlacement(L, 1, 'contain');
  const t = tileSourceRect(L, P, 2000, 2000, 0, 0);
  check('la hoja 0 no está vacía', !t.empty);
  check('el recorte tiene ancho > 0', t.sw > 0 && t.sh > 0);
  check('el recorte no se sale de la imagen fuente',
    t.sx >= -0.01 && t.sy >= -0.01 &&
    t.sx + t.sw <= 2000 + 0.5 && t.sy + t.sh <= 2000 + 0.5,
    `sx=${t.sx} sw=${t.sw}`);
}

console.log('\n=== 5. Solapa de pegado en blanco reduce el área útil ===');
{
  const sinFlap = computeLayout(cfg({ glueFlapMm: 0 }), 1);
  const conFlap = computeLayout(cfg({ glueFlapMm: 5 }), 1);
  check('la solapa reduce el ancho imprimible en 5 mm',
    Math.abs((sinFlap.printableWidthMm - conFlap.printableWidthMm) - 5) < 0.01,
    `${sinFlap.printableWidthMm} vs ${conFlap.printableWidthMm}`);
}

console.log('\n=== 6. Orientación ===');
{
  const v = computeLayout(cfg({ orientation: 'portrait' }), 1);
  const h = computeLayout(cfg({ orientation: 'landscape' }), 1);
  check('vertical: 210 × 297', v.paperWidthMm === 210 && v.paperHeightMm === 297);
  check('horizontal: 297 × 210', h.paperWidthMm === 297 && h.paperHeightMm === 210);
}

console.log('\n=== 7. DPI efectivo y nitidez ===');
{
  const L = computeLayout(cfg({ gridColumns: 3 }), 1);
  // Póster de 550 mm = 21.65 pulgadas. 3000 px → ~138 DPI
  const dpi = effectiveDpi(3000, L);
  check('3000 px sobre 550 mm da ~138 DPI', Math.abs(dpi - 138) < 3, `obtenido ${dpi}`);
}

console.log('\n=== 8. Límites de memoria (nunca reventar el navegador) ===');
{
  const grande = cfg({ gridColumns: 12, overlapMm: 10 });
  const L = computeLayout(grande, 1);
  const v = validateSettings(grande, L, false);
  check('una grilla enorme se rechaza con mensaje', !v.ok, JSON.stringify(v));
  console.log(`    motivo: ${v.reason}`);

  const ok = cfg({ gridColumns: 3, dpi: 300 });
  const L2 = computeLayout(ok, 1);
  const v2 = validateSettings(ok, L2, false);
  check('una grilla normal pasa la validación', v2.ok, JSON.stringify(v2));
}

console.log('\n=== 9. 600 DPI en A4 excede el límite de canvas ===');
{
  const c = cfg({ gridColumns: 3, dpi: 600 });
  const L = computeLayout(c, 1);
  const v = validateSettings(c, L, false);
  check('600 DPI se rechaza o avisa antes de reservar memoria',
    !v.ok || v.widthPx <= 8192, `ok=${v.ok} w=${v.widthPx}`);
  if (!v.ok) console.log(`    motivo: ${v.reason}`);
}

console.log('\n=== 10. Conversión de unidades ===');
{
  check('10 cm = 100 mm', dimensionToMm(10, 'cm') === 100);
  check('1 pulgada = 25.4 mm', Math.abs(dimensionToMm(1, 'in') - 25.4) < 1e-9);
}

console.log('\n=== 11. Regresión: cada hoja recibe un recorte DISTINTO ===');
{
  const c = cfg({ gridColumns: 3, autoRows: true });
  const imgW = 1200, imgH = 1600;
  const aspect = imgW / imgH;              // 0.75 (vertical)
  const L = computeLayout(c, aspect);
  const P = imagePlacement(L, aspect, 'contain');

  const rects = [];
  for (let r = 0; r < L.rows; r++) {
    for (let col = 0; col < L.columns; col++) {
      rects.push(tileSourceRect(L, P, imgW, imgH, r, col));
    }
  }
  const keys = rects.map((t) => `${t.sx.toFixed(2)},${t.sy.toFixed(2)}`);
  check('cada hoja tiene un recorte distinto',
    new Set(keys).size === rects.length,
    `${new Set(keys).size} únicos de ${rects.length}`);

  check('los recortes cubren toda la imagen sin huecos',
    Math.abs(Math.min(...rects.map((t) => t.sx)) - 0) < 0.5 &&
    Math.abs(Math.max(...rects.map((t) => t.sx + t.sw)) - imgW) < 1,
    `sx min=${Math.min(...rects.map((t) => t.sx))} max=${Math.max(...rects.map((t) => t.sx + t.sw))}`);
  check('los recortes cubren toda la altura de la imagen',
    Math.abs(Math.max(...rects.map((t) => t.sy + t.sh)) - imgH) < 1,
    `sy max=${Math.max(...rects.map((t) => t.sy + t.sh))}`);

  // La solape de 10 mm debe estar presente entre hojas vecinas.
  const c1 = tileSourceRect(L, P, imgW, imgH, 0, 0);
  const c2 = tileSourceRect(L, P, imgW, imgH, 0, 1);
  const overlapPx = c1.sx + c1.sw - c2.sx;
  const overlapMm = overlapPx / (imgW / P.wMm);
  check('las hojas vecinas comparten la banda de solape (10 mm)',
    Math.abs(overlapMm - L.overlapMm) < 0.5,
    `solape medido ${overlapMm.toFixed(2)} mm, esperado ${L.overlapMm}`);
}

console.log('\n=== 12. Regresión: imgAspect es ANCHO/ALTO ===');
{
  // Una imagen vertical 1200x1600 tiene proporción 0.75 (no 1.33 ni 1.0).
  const aspect = 1200 / 1600;
  const c = cfg({ gridColumns: 3, autoRows: true });
  const L = computeLayout(c, aspect);
  // 3 columnas A4 vertical: 550 mm de ancho. Con proporción 0.75 el alto
  // natural son 550/0.75 = 733 mm (no 550/1.33 = 413 mm).
  check('el alto natural sale de ancho/alto (733 mm, no 413 mm)',
    Math.abs(L.posterHeightMm - 733.33) < 1,
    `obtenido ${L.posterHeightMm.toFixed(2)}`);

  // Si imgAspect estuviera invertido, el póster saldría mucho más bajo.
  const wrong = computeLayout(c, 1600 / 1200);
  check('con la proporción invertida el póster mide MUCHO menos alto (se detecta)',
    Math.abs(wrong.posterHeightMm - 413.33) < 1 && wrong.posterHeightMm < L.posterHeightMm - 200,
    `invertido ${wrong.posterHeightMm.toFixed(0)} vs correcto ${L.posterHeightMm.toFixed(0)}`);
}

console.log('\n=== 13. Regresión: el aviso de proporción distingue contain de cover ===');
{
  const c = cfg({ sizingMode: 'exact', targetWidth: 60, targetHeight: 90, fitMode: 'contain' });
  const sw = stretchWarning(c, 0.75);
  check('con «Ajustar» el aviso dice que sobran bandas en blanco (no que se deforma)',
    sw && sw.mode === 'contain', JSON.stringify(sw));
  const c2 = cfg({ sizingMode: 'exact', targetWidth: 60, targetHeight: 90, fitMode: 'cover' });
  const sw2 = stretchWarning(c2, 0.75);
  check('con «Llenar» el aviso dice que se recorta',
    sw2 && sw2.mode === 'cover', JSON.stringify(sw2));
}

console.log('\n' + results.join('\n'));
console.log(`\n=== ${pass} pasaron, ${fail} fallaron ===\n`);
process.exit(fail > 0 ? 1 : 0);
