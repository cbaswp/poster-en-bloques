# 发布说明 / Publishing notes

Este repositorio contiene la app web estática de **Póster en Bloques**.

## GitHub Pages

1. En el repo: **Settings → Pages**
2. **Source**: *Deploy from a branch* → rama `main`, carpeta `/ (root)`
3. Guardar. GitHub publica en `https://<usuario>.github.io/<repo>/` en 1-2 minutos.

El `index.html` está en la raíz, así que GitHub Pages lo sirve directamente.
No hay build step en GitHub: el archivo ya viene compilado y autocontenido.

## Estructura

- `index.html` — la app completa en un solo archivo (653 KB, autocontenido).
  Es lo único que GitHub Pages necesita.
- `README.md` — documentación para el equipo.
- `LEEME.txt` — la misma guía en texto plano, para quien no use GitHub.

## Regenerar `index.html`

El `index.html` se genera desde el proyecto original (que vive fuera de este
repo) con `node tools/build-standalone.mjs`, que:

1. Fusiona `js/app.js` + `js/geometry.js` + `js/pdf.js` con `esbuild`.
2. Incrusta `vendor/pdf-lib.min.js`.
3. Convierte el Web Worker de tipo `module` en un worker clásico servido
   desde un `blob:` URL (necesario para que funcione con doble clic).

Si cambias el código original, hay que regenerar el HTML y volver a subirlo.

## Privacidad

Todo el procesamiento ocurre en el navegador del usuario. La imagen nunca
sale de su equipo.
