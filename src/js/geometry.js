/* =============================================================================
 * geometry.js — Motor de geometría del póster en bloques.
 *
 * TODA la aritmética vive acá, en MILÍMETROS. El PDF convierte a puntos
 * SOLO en el borde de exportación (mmToPt). Esta es la lección de
 * https://dev.to/gaven/modeling-margins-and-overlap-in-a-browser-based-pdf-layout-engine-4ene
 * y evita el bug más común: mezclar unidades y que el póster salga de otro
 * tamaño del pedido.
 *
 * UNIDAD DE TRABAJO: el milímetro físico.
 * ========================================================================== */

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / 25.4;

/** Convierte mm → puntos PDF. */
export const mmToPt = (mm) => (mm * 72) / 25.4;

/** Convierte una dimensión de la interfaz (cm o pulgadas) → mm. */
export function dimensionToMm(value, unit) {
  if (!Number.isFinite(value)) return 0;
  return unit === 'in' ? value * MM_PER_INCH : value * 10;
}

/** Convierte mm → dimensión de la interfaz (cm o pulgadas). */
export function mmToDimension(mm, unit) {
  return unit === 'in' ? mm / MM_PER_INCH : mm / 10;
}

/* -----------------------------------------------------------------------------
 * Tamaños de papel. Medidas reales, no aproximadas.
 * `w` y `h` SIEMPRE en vertical (portrait); la orientación se aplica después.
 * -------------------------------------------------------------------------- */
export const PAPER_SIZES = [
  { id: 'a4',       name: 'A4',              w: 210,   h: 297   },
  { id: 'letter',   name: 'Carta (Letter)',  w: 215.9, h: 279.4 },
  { id: 'legal',    name: 'Legal',           w: 215.9, h: 355.6 },
  { id: 'a3',       name: 'A3',              w: 297,   h: 420   },
  { id: 'a2',       name: 'A2',              w: 420,   h: 594   },
  { id: 'tabloid',  name: 'Tabloide',        w: 279.4, h: 431.8 },
  { id: 'a5',       name: 'A5',              w: 148,   h: 210   },
  { id: 'halflet',  name: 'Half Letter',     w: 139.7, h: 215.9 },
  { id: 'exec',     name: 'Executive',       w: 184.15,h: 266.7 },
  { id: 'archb',    name: 'Arch B',          w: 305,   h: 457   },
  { id: 'superb',   name: 'Super B',         w: 305,   h: 487   },
];

export const PAPER_BY_ID = Object.fromEntries(PAPER_SIZES.map((p) => [p.id, p]));

/** Tamaños de póster estándar, para presets del selector. */
export const POSTER_PRESETS = [
  { id: 'a0', name: 'A0 (84 × 119 cm)', w: 841, h: 1189 },
  { id: 'a1', name: 'A1 (59 × 84 cm)', w: 594, h: 841 },
  { id: 'a2p', name: 'A2 (42 × 59 cm)', w: 420, h: 594 },
  { id: '24x36', name: '24" × 36"', w: 609.6, h: 914.4 },
  { id: '18x24', name: '18" × 24"', w: 457.2, h: 609.6 },
];

/* -----------------------------------------------------------------------------
 * Límites. Protegen al navegador de congelarse: se estima el trabajo ANTES
 * de reservar memoria. Los números vienen del artículo de Gaven:
 * móvil 24 páginas / 450k celdas, escritorio 80 páginas / 1.6M celdas.
 * -------------------------------------------------------------------------- */
export const LIMITS = {
  maxCanvasPixels: 16e6,   // por hoja
  maxCanvasSide: 8192,     // por hoja
  maxPagesMobile: 24,
  maxPagesDesktop: 80,
  maxDpi: 600,
  minDpi: 75,
  maxOverlapMm: 30,
  maxMarginMm: 30,
  maxGlueFlapMm: 15,
};

/* -----------------------------------------------------------------------------
 * Configuración por defecto.
 * -------------------------------------------------------------------------- */
export function defaultConfig() {
  return {
    // Modo de tamaño: 'pages' (grid) | 'exact' (tamaño pedido)
    sizingMode: 'pages',
    targetWidth: 60,     // cm
    targetHeight: 90,    // cm
    targetUnit: 'cm',    // 'cm' | 'in'

    gridColumns: 3,
    gridRows: 0,        // 0 = automático según la proporción de la imagen
    autoRows: true,

    paperSizeId: 'a4',
    orientation: 'portrait',   // 'portrait' | 'landscape'
    customPaper: null,         // {w,h} en mm si el usuario elige "Personalizado"

    // Márgenes NO imprimibles, en mm, POR LADO.
    // La zona muerta de una impresora casi nunca es simétrica (alimentación
    // trasera), por eso cada lado tiene su propio valor.
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    marginSymmetric: true,

    // Solapamiento (mm): la banda de contenido DUPLICADA entre hojas vecinas.
    overlapMm: 10,

    // Solapa de pegado (mm): franja EN BLANCO en el borde derecho/inferior de
    // cada hoja, reservada ANTES de calcular la grid, para que la línea de
    // corte tenga sitio y el adhesivo no tape la imagen.
    glueFlapMm: 0,

    dpi: 300,
    fitMode: 'contain',    // 'contain' (ajustar) | 'cover' (llenar)
    printGuides: true,
    halftone: false,
    halftonePitch: 3,      // mm
    halftoneShape: 'circle', // 'circle' | 'square'

    // Crop de la imagen fuente (fracción 0..1)
    crop: null,           // {x, y, w, h} normalizado
  };
}

/* -----------------------------------------------------------------------------
 * Cálculo principal.
 * -------------------------------------------------------------------------- */

/**
 * Devuelve las dimensiones del papel ya con la orientación aplicada.
 */
export function paperDims(config) {
  const p = config.customPaper || PAPER_BY_ID[config.paperSizeId] || PAPER_BY_ID.a4;
  const w = p.w, h = p.h;
  return config.orientation === 'landscape'
    ? { widthMm: h, heightMm: w, paperId: p.id || 'custom' }
    : { widthMm: w, heightMm: h, paperId: p.id || 'custom' };
}

/**
 * Área imprimible de UNA hoja, en mm, descontando los cuatro márgenes.
 */
export function printableArea(config) {
  const { widthMm, heightMm } = paperDims(config);
  const m = config.margins;
  return {
    paperWidthMm: widthMm,
    paperHeightMm: heightMm,
    // El ancho imprimible REAL de la hoja, ya con la solapa de pegado
    // reservada (queda en blanco en el borde derecho).
    printableWidthMm: Math.max(1, widthMm - m.left - m.right - config.glueFlapMm),
    printableHeightMm: Math.max(1, heightMm - m.top - m.bottom - config.glueFlapMm),
    // Área útil de imagen (sin la solapa en blanco)
    contentWidthMm: Math.max(1, widthMm - m.left - m.right - config.glueFlapMm),
    contentHeightMm: Math.max(1, heightMm - m.top - m.bottom - config.glueFlapMm),
  };
}

/**
 * Calcula la grilla completa.
 *
 * CORRECCIÓN IMPORTANTE frente a blockposter.net: la fórmula correcta del
 * tamaño final es
 *     posterWidth = contentWidth + (cols - 1) * stepX
 * donde stepX = contentWidth - overlap.
 * (blockposter usa cols * printable - (cols-1) * overlap, que da un tamaño
 * final slightly menor al pedido cuando hay solapamiento.)
 *
 * @param {object} config
 * @param {number} imgAspect  ancho / alto de la imagen fuente (en px)
 * @returns {object} layout
 */
export function computeLayout(config, imgAspect) {
  const area = printableArea(config);
  const { contentWidthMm: cw, contentHeightMm: ch } = area;
  const overlap = Math.min(config.overlapMm, Math.max(0, cw - 1));

  // Paso entre hojas: cuánto avanza la grilla por columna.
  const stepX = Math.max(1, cw - overlap);
  const stepY = Math.max(1, ch - overlap);

  let columns, rows;
  let posterWidthMm, posterHeightMm;
  let alignTop = false;

  if (config.sizingMode === 'exact') {
    // El usuario pidió un tamaño exacto. Ese es el ÁREA DEL PÓSTER. La
    // grilla de papel puede quedar más grande (sobran hojas en blanco) y esa
    // diferencia se centra.
    const wantW = Math.max(1, dimensionToMm(config.targetWidth, config.targetUnit));
    const wantH = Math.max(1, dimensionToMm(config.targetHeight, config.targetUnit));
    posterWidthMm = wantW;
    posterHeightMm = wantH;
    columns = Math.max(1, Math.ceil((wantW - overlap) / stepX));
    rows = Math.max(1, Math.ceil((wantH - overlap) / stepY));
  } else {
    // Modo grid: el usuario dice cuántas hojas de ancho. El alto natural sale
    // de la proporción de la imagen.
    columns = Math.max(1, config.gridColumns | 0);
    posterWidthMm = cw + (columns - 1) * stepX;

    if (config.autoRows || !config.gridRows) {
      const naturalH = posterWidthMm / imgAspect;
      rows = Math.max(1, Math.ceil((naturalH - overlap) / stepY));
      // El póster mide lo que mide la IMAGEN, no el papel sobrante. El
      // sobrante queda en UNA franja al final (última fila), no repartido.
      posterHeightMm = naturalH;
      alignTop = true;
    } else {
      rows = Math.max(1, config.gridRows | 0);
      posterHeightMm = ch + (rows - 1) * stepY;
      alignTop = true;
    }
  }

  const totalPages = columns * rows;

  // La grilla de papel puede ser MAYOR que el área del póster pedido.
  const gridWidthMm = cw + (columns - 1) * stepX;
  const gridHeightMm = ch + (rows - 1) * stepY;
  const offsetXMm = Math.max(0, (gridWidthMm - posterWidthMm) / 2);
  const offsetYMm = alignTop ? 0 : Math.max(0, (gridHeightMm - posterHeightMm) / 2);

  return {
    ...area,
    columns,
    rows,
    totalPages,
    overlapMm: overlap,
    stepXMm: stepX,
    stepYMm: stepY,
    posterWidthMm,
    posterHeightMm,
    gridWidthMm,
    gridHeightMm,
    offsetXMm,
    offsetYMm,
    glueFlapMm: config.glueFlapMm,
    margins: { ...config.margins },
  };
}

/**
 * Retorno de la imagen dentro de la grilla.
 *
 * - contain: entra completa dentro del ÁREA DEL PÓSTER, con bandas si la
 *   proporción no calza.
 * - cover:   cubre el área del póster, se recorta el sobrante.
 *
 * Las coordenadas devueltas ya están en el sistema de la GRILLA (mm), que es
 * lo que necesita tileSourceRect.
 */
export function imagePlacement(layout, imgAspect, fitMode) {
  const { posterWidthMm, posterHeightMm } = layout;

  if (fitMode === 'cover') {
    const w = Math.max(posterWidthMm, posterHeightMm * imgAspect);
    const h = w / imgAspect;
    return {
      wMm: w,
      hMm: h,
      xMm: layout.offsetXMm + (posterWidthMm - w) / 2,
      yMm: layout.offsetYMm + (posterHeightMm - h) / 2,
      cropped: true,
    };
  }

  // contain
  let w = posterWidthMm;
  let h = w / imgAspect;
  if (h > posterHeightMm) {
    h = posterHeightMm;
    w = h * imgAspect;
  }
  return {
    wMm: w,
    hMm: h,
    xMm: layout.offsetXMm + (posterWidthMm - w) / 2,
    yMm: layout.offsetYMm + (posterHeightMm - h) / 2,
    cropped: false,
  };
}

/**
 * El rectángulo de la imagen fuente que cae en una hoja dada.
 * Devuelve coordenadas en PÍXELES de la imagen fuente y el destino en mm
 * dentro de la hoja.
 */
export function tileSourceRect(layout, placement, srcW, srcH, row, col) {
  // Rectángulo de esta hoja dentro de la grilla (mm).
  const sheetX = col * layout.stepXMm;
  const sheetY = row * layout.stepYMm;
  const sheetW = layout.contentWidthMm;
  const sheetH = layout.contentHeightMm;

  // Rectángulo de la imagen dentro de la grilla (mm).
  const imgX = placement.xMm;
  const imgY = placement.yMm;
  const imgWmm = placement.wMm;
  const imgHmm = placement.hMm;

  // Intersección hoja ∩ imagen
  const ix0 = Math.max(sheetX, imgX);
  const iy0 = Math.max(sheetY, imgY);
  const ix1 = Math.min(sheetX + sheetW, imgX + imgWmm);
  const iy1 = Math.min(sheetY + sheetH, imgY + imgHmm);

  const iw = ix1 - ix0;
  const ih = iy1 - iy0;

  if (iw <= 0 || ih <= 0) {
    // Esta hoja queda EN BLANCO (franja parcial de la grilla).
    return { empty: true, dxMm: 0, dyMm: 0, dwMm: 0, dhMm: 0, sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  // Escala px/mm de la imagen fuente.
  const pxPerMm = srcW / imgWmm;

  return {
    empty: false,
    // Offset dentro de la hoja (mm) — la imagen puede no empezar en 0.
    dxMm: ix0 - sheetX,
    dyMm: iy0 - sheetY,
    dwMm: iw,
    dhMm: ih,
    sx: (ix0 - imgX) * pxPerMm,
    sy: (iy0 - imgY) * pxPerMm,
    sw: iw * pxPerMm,
    sh: ih * pxPerMm,
  };
}

/**
 * DPI efectivo: cuántos píxeles reales hay por pulgada impresa.
 */
export function effectiveDpi(imgW, layout) {
  const posterInches = layout.posterWidthMm / MM_PER_INCH;
  if (posterInches <= 0) return 0;
  return Math.round(imgW / posterInches);
}

/** Nivel de nitidez, para avisar al usuario. */
export function sharpnessTier(dpi) {
  if (dpi >= 200) return { tier: 'sharp', label: 'Nítida', ok: true };
  if (dpi >= 120) return { tier: 'ok', label: 'Aceptable', ok: true };
  return { tier: 'soft', label: 'Blanda', ok: false };
}

/**
 * Estima si una configuración es viable antes de reservar memoria.
 * Devuelve { ok, error, reason, pixelsPerSheet }.
 */
export function validateSettings(config, layout, isMobile) {
  const maxPages = isMobile ? LIMITS.maxPagesMobile : LIMITS.maxPagesDesktop;
  if (layout.totalPages > maxPages) {
    return {
      ok: false,
      reason: `Son ${layout.totalPages} hojas y el límite es ${maxPages}. Reduce el número de hojas o agranda la grilla.`,
      code: 'pages',
    };
  }
  const wpx = Math.round((layout.contentWidthMm / MM_PER_INCH) * config.dpi);
  const hpx = Math.round((layout.contentHeightMm / MM_PER_INCH) * config.dpi);
  if (wpx * hpx > LIMITS.maxCanvasPixels) {
    return {
      ok: false,
      reason: `Una hoja a ${config.dpi} DPI necesita ${((wpx * hpx) / 1e6).toFixed(1)} megapíxeles y el límite es ${(LIMITS.maxCanvasPixels / 1e6).toFixed(0)}. Baja la resolución.`,
      code: 'canvas',
    };
  }
  if (Math.max(wpx, hpx) > LIMITS.maxCanvasSide) {
    return {
      ok: false,
      reason: `Una hoja a ${config.dpi} DPI mide ${Math.max(wpx, hpx)} px de lado y el límite es ${LIMITS.maxCanvasSide}. Baja la resolución.`,
      code: 'canvas',
    };
  }
  return { ok: true, pixelsPerSheet: wpx * hpx, widthPx: wpx, heightPx: hpx };
}

/**
 * Consumo estimado de papel y tinta.
 * La tinta es una APROXIMACIÓN: depende de la cobertura real de la imagen y
 * de si la impresora es HP/LG (las HP imprimen la "#2" como un tono más
 * gris que el CMYK real). Por eso se muestra como rango.
 */
export function estimateConsumption(layout, config, imgW, imgH) {
  const sheets = layout.totalPages;
  const areaM2 = (layout.posterWidthMm / 1000) * (layout.posterHeightMm / 1000);
  // Gramos de tinta: ~11 % de cobertura CMYK typical sobre 300 DPI A4.
  const gramsPerSheet = (layout.contentWidthMm / 1000) * (layout.contentHeightMm / 1000) * 11;
  const inkG = gramsPerSheet * sheets;
  // Un cartucho de tintaoprinter casera ~ 8-12 g de color.
  const cartridges = inkG / 10;
  return {
    sheets,
    areaM2,
    inkGramsLow: inkG * 0.7,
    inkGramsHigh: inkG * 1.4,
    cartridgesLow: (inkG * 0.7) / 12,
    cartridgesHigh: (inkG * 1.4) / 8,
  };
}

/**
 * Hojas que quedarán EN BLANCO (franja parcial de la grilla).
 */
export function blankSheets(layout, placement, imgW, imgH) {
  const blanks = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      const t = tileSourceRect(layout, placement, imgW, imgH, r, c);
      if (t.empty) blanks.push({ row: r, col: c, label: `R${r + 1}·C${c + 1}` });
    }
  }
  return blanks;
}

/**
 * Cobertura de cada hoja: qué fracción del área de la hoja tiene imagen.
 * 1 = hoja llena, 0 = hoja en blanco.
 *
 * La última fila de un póster block SIEMPRE queda parcial (el papel no
 * divide exacto). Eso no es un error: se recorta. Pero el usuario debe
 * saberlo para no imprimir hojas que no aportan nada.
 */
export function sheetCoverage(layout, placement, imgW, imgH) {
  const out = [];
  const full = layout.contentWidthMm * layout.contentHeightMm;
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.columns; c++) {
      const t = tileSourceRect(layout, placement, imgW, imgH, r, c);
      const frac = t.empty ? 0 : Math.min(1, (t.dwMm * t.dhMm) / full);
      out.push({ row: r, col: c, label: `R${r + 1}·C${c + 1}`, coverage: frac });
    }
  }
  return out;
}

/**
 * Hojas parcialmente cubiertas: tienen imagen pero les sobra papel.
 * Se recortan al montar.
 */
export function partialSheets(layout, placement, imgW, imgH) {
  return sheetCoverage(layout, placement, imgW, imgH).filter((s) => s.coverage > 0.001 && s.coverage < 0.999);
}

/**
 * Advertencia de proporción: qué pasa si el tamaño exacto pedido no coincide
 * con la proporción de la imagen.
 *
 * OJO con el vocabulario: con ajuste «Ajustar» (contain) la imagen NO se
 * deforma: le sobran bandas en blanco. Solo con «Llenar» (cover) se recorta.
 * Decir "salga estirada" en modo contain sería mentirle al usuario.
 *
 * @returns {null | {percent:number, mode:'contain'|'cover', direction:string}}
 */
export function stretchWarning(config, imgAspect) {
  if (config.sizingMode !== 'exact') return null;
  const w = dimensionToMm(config.targetWidth, config.targetUnit);
  const h = dimensionToMm(config.targetHeight, config.targetUnit);
  if (w <= 0 || h <= 0) return null;
  const want = w / h;
  const delta = Math.abs(want - imgAspect) / imgAspect;
  if (delta < 0.02) return null;
  const mode = config.fitMode === 'cover' ? 'cover' : 'contain';
  return {
    percent: Math.round(delta * 100),
    mode,
    direction: want > imgAspect ? 'comprimida' : 'estirada',
  };
}
