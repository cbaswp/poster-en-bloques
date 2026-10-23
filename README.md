# Póster en Bloques

Genera **pósters murales** a partir de una sola imagen, dividiéndola en hojas
A4 que se imprimen y se unen. Todo ocurre **en tu navegador**: la imagen
nunca se sube a ningún servidor.

## Cómo usarlo

Abre `index.html` en tu navegador (doble clic, o desde la URL de GitHub
Pages). No hay que instalar nada.

1. Arrastra tu imagen (o haz clic para elegirla).
2. Ajusta el tamaño del póster en centímetros y las hojas que vas a usar.
3. Presiona **Generar PDF**.
4. Imprime las hojas A4 y únelas según la guía de montaje.

Botones útiles:

- **Hoja de calibración** — una hoja con escalas para comprobar que tu
  impresora imprime a escala real (algunos navegadores ajustan al papel).
- **Hoja de prueba** — una hoja con la imagen a tamaño completo, para
  revisar la calidad antes de imprimir todo.
- **Guía de montaje** — instrucciones de cómo pegar las hojas.

## Requisitos

- Un navegador moderno: **Chrome, Edge o Firefox**.
- Nada más: no necesita Node, ni Python, ni internet, ni derechos de
  administrador.

## Privacidad

La imagen se procesa **100% en tu computadora**. No hay uploads, no hay
servidor, no hay registro de lo que haces. Puedes usarlo con material
confidencial sin ningún tipo de preocupación.

## Detalle técnico

`index.html` es un archivo único y autocontenido (653 KB) que trae dentro:

- el motor de cálculo del layout (en milímetros),
- el renderizador de hojas (Web Worker + `OffscreenCanvas`),
- `pdf-lib` para armar el PDF.

El proyecto original (`js/geometry.js`, `js/app.js`, `js/worker.js`,
`js/pdf.js`) usa módulos ES y un Web Worker de tipo `module`. Bajo
`file://` el navegador los rechaza por CORS (origen `null`), así que el
build los fusiona con `esbuild` y convierte el worker en un worker clásico
servido desde un `blob:` URL, que sí funciona con doble clic.

El PDF se arma en el navegador; ninguna hoja se renderiza en un canvas del
tamaño del póster, solo del tamaño de una hoja, para que la memoria no
explote con pósters grandes.

## Créditos

`pdf-lib` — MIT License, https://github.com/Hopding/pdf-lib
