#!/usr/bin/env node
/**
 * build-standalone.mjs — empaqueta Póster en Bloques en UN SOLO index.html
 * que funciona con doble clic (file://), sin servidor y sin instalar nada.
 *
 * Qué hace:
 *  1. Bundlea js/app.js + js/geometry.js + js/pdf.js con esbuild (IIFE).
 *  2. Inlina vendor/pdf-lib.min.js (UMD → globalThis.PDFLib).
 *  3. Convierte el worker de módulo a worker CLÁSICO servido desde un
 *     blob: URL. Motivo (medido, no supuesto): bajo file:// el navegador
 *     rechaza módulos ES y workers de módulo por CORS de origen "null".
 *     Un worker clásico desde blob: URL SÍ funciona.
 *  4. Reemplaza los <script src=...> del index.html por scripts inline.
 *
 * Uso:  node tools/build-standalone.mjs
 * Sale: dist/index.html  (autocontenido, ~700 KB)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const ESBUILD = process.env.ESBUILD_BIN
  || '/home/sofema/.hermes/hermes-agent/node_modules/.bin/esbuild';

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// --------------------------------------------------------------- 1. bundle
const bundle = execFileSync(ESBUILD, [
  resolve(ROOT, 'js/app.js'),
  '--bundle',
  '--format=iife',
  '--target=es2020',
  '--legal-comments=none',
  '--minify',
], { encoding: 'utf8' });

// ------------------------------------- 2. worker: módulo → clásico + blob
// El worker original no tiene imports (es autónomo), así que bajarlo a
// worker clásico no pierde nada. El problema medido bajo file:// NO es el
// código del worker sino que `new Worker('js/worker.js', {type:'module'})`
// y `import()` de módulos ES son rechazados por CORS con origen "null".
let appBundle = bundle.replace(
  /new Worker\(\s*(['"])js\/worker\.js\1\s*,\s*\{\s*type:\s*(['"])module\2\s*\}\s*\)/g,
  'new Worker(window.__posterWorkerURL)'
);
if (appBundle === bundle) {
  console.error('✗ No se encontró el patrón new Worker(...js/worker.js...{type:module})');
  process.exit(1);
}

const workerSrc = read('js/worker.js');

// ------------------------------------------------------- 3. ensamblar HTML
let html = read('index.html');

// Vendor: PDFLib (UMD) inline.
// OJO: se usa una FUNCIÓN de reemplazo, no un string. Con un string,
// JavaScript interpreta `$&`, `$'` y `` $` `` dentro del contenido minificado
// de PDFLib como patrones de sustitución — `$'` re-inserta el resto del HTML
// original (incluidos los <script src=...> que se pretendía eliminar).
const pdfLib = read('vendor/pdf-lib.min.js');
html = html.replace(
  /<script src="vendor\/pdf-lib\.min\.js"><\/script>/,
  () => `<script>/* pdf-lib.min.js (PDFLib) — MIT */\n${pdfLib}\n</script>`
);

// Worker + bundle inline. El texto del worker va en un <script type="text/plain">
// y se convierte a blob: URL en tiempo de ejecución.
const safeWorker = workerSrc.replace(/<\/script/gi, '<\\/script');
html = html.replace(
  /<script type="module" src="js\/app\.js"><\/script>/,
  () => `<script id="__poster_worker_src" type="text/plain">\n${safeWorker}\n</script>
<script>
/* Bootstrap: convierte el worker inline en un blob: URL usable bajo file:// */
(function () {
  var src = document.getElementById('__poster_worker_src').textContent;
  var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  window.__posterWorkerURL = url;
})();
</script>
<script>/* app.js + geometry.js + pdf.js (bundle esbuild, IIFE) */
${appBundle}
</script>`
);

if (html.includes('src="js/app.js"') || html.includes('src="vendor/')) {
  console.error('✗ Quedaron referencias externas sin inlinear');
  process.exit(1);
}

// --------------------------------------------------------------- 4. escribir
// Solo se borra el index.html: el LEEME.txt (u otros archivos) viven en dist/
// y NO deben desaparecer en cada build.
mkdirSync(DIST, { recursive: true });
writeFileSync(resolve(DIST, 'index.html'), html, 'utf8');

// --------------------------------------------------------------- 5. chequeos
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
const checks = [
  ['sin <script src=>', !/<script[^>]+src=/i.test(html)],
  ['sin import() dinámico', !/import\(\s*['"]\./.test(html)],
  ['PDFLib inline', html.includes('PDFLib')],
  ['worker blob bootstrap', html.includes('__posterWorkerURL')],
  ['worker sin type:module', !/new Worker\([^)]*type:\s*['"]module['"]/.test(html)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? '✓' : '✗'} ${name}`);
  if (!pass) ok = false;
}
console.log(`\ndist/index.html — ${kb} KB — ${ok ? 'OK' : 'REVISAR'}`);
process.exit(ok ? 0 : 1);
