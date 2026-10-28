# Póster en Bloques

Genera **pósters murales** a partir de una sola imagen, dividiéndola en hojas
A4 que se imprimen y se unen. Todo ocurre **en tu navegador**: la imagen
nunca se sube a ningún servidor.

## Cómo usarlo

Abre `index.html` en tu navegador (doble clic, o desde la URL de GitHub
Pages). No hay que instalar nada.

1. Arrastra tu imagen (o haz clic para elegirla).
2. Ajusta el tamaño del póster en centímetros y las hojas que vas a usar.
3. Presiona **⬇ Descargar PDF**.
4. Imprime las hojas A4 y únelas según la guía de montaje.

Botones útiles:

- **🖨️ Imprimir solo 1 hoja de prueba** — una hoja con la imagen a tamaño
  completo, para revisar la escala antes de imprimir todo.
- **🖨️ Imprimir todas las hojas individualmente** — abre el diálogo de
  impresión del sistema con cada hoja en su propia página (no descarga un
  PDF). Es la vía recomendada para imprimir de verdad.
- **📐 Hoja de calibración** — una hoja con escalas para comprobar que tu
  impresora imprime a escala real (algunos navegadores ajustan al papel).
- **🧭 Guía de montaje** — instrucciones de cómo pegar las hojas.

## Requisitos

- Un navegador moderno: **Chrome, Edge o Firefox**.
- Nada más: no necesita Node, ni Python, ni internet, ni derechos de
  administrador.

## Privacidad

La imagen se procesa **100% en tu computadora**. No hay uploads, no hay
servidor, no hay registro de lo que haces. Puedes usarlo con material
confidencial sin ningún tipo de preocupación.

## Estructura del repositorio

- `index.html` — **la app completa en un solo archivo** (655 KB,
  autocontenido). Es lo que sirve GitHub Pages y lo que se abre con doble
  clic.
- `src/` — el código fuente del proyecto:
  - `src/index.html` — la página original (usa módulos ES y sirve por HTTP).
  - `src/js/geometry.js` — el cálculo del layout, todo en milímetros.
  - `src/js/app.js` — controlador de la interfaz y generación de hojas.
  - `src/js/worker.js` — renderiza una hoja por vez en un `OffscreenCanvas`.
  - `src/js/pdf.js` — arma el PDF con PDFLib.
  - `src/vendor/pdf-lib.min.js` — PDFLib (MIT).
  - `src/tests/test-geometry.mjs` — 33 tests sin navegador.
  - `src/tools/build-standalone.mjs` — empaqueta todo en un `index.html`.
- `scripts/` — utilidades para publicar el repo y guardar el token de GitHub.

### Regenerar `index.html` (el archivo de la raíz)

```bash
cd src
node tools/build-standalone.mjs
cp dist/index.html ../index.html
```

El build usa `esbuild` para fusionar los módulos y bajar el Web Worker de
tipo `module` a worker clásico servido desde un `blob:` URL (necesario para
que funcione con doble clic, bajo `file://`).

### Correr los tests

```bash
cd src
node tests/test-geometry.mjs     # 33 deben pasar
```

## Detalle técnico

`index.html` es un archivo único y autocontenido (655 KB) que trae dentro:

- el motor de cálculo del layout (en milímetros),
- el renderizador de hojas (Web Worker + `OffscreenCanvas`),
- `pdf-lib` para armar el PDF.

El proyecto original (`src/js/geometry.js`, `src/js/app.js`,
`src/js/worker.js`, `src/js/pdf.js`) usa módulos ES y un Web Worker de tipo
`module`. Bajo `file://` el navegador los rechaza por CORS (origen `null`),
así que el build los fusiona con `esbuild` y convierte el worker en un
worker clásico servido desde un `blob:` URL, que sí funciona con doble clic.

El PDF se arma en el navegador; ninguna hoja se renderiza en un canvas del
tamaño del póster, solo del tamaño de una hoja, para que la memoria no
explote con pósters grandes.

## Créditos

`pdf-lib` — MIT License, https://github.com/Hopding/pdf-lib
