# 发布说明 / Publishing notes

Este repositorio contiene la app web estática de **Póster en Bloques**.

## GitHub Pages

1. En el repo: **Settings → Pages**
2. **Source**: *Deploy from a branch* → rama `main`, carpeta `/ (root)`
3. Guardar. GitHub publica en `https://<usuario>.github.io/<repo>/` en 1-2 minutos.

El `index.html` está en la raíz, así que GitHub Pages lo sirve directamente.
No hay build step en GitHub: el archivo ya viene compilado y autocontenido.

## Estructura

- `index.html` — la app completa en un solo archivo (655 KB, autocontenido).
  Es lo único que GitHub Pages necesita.
- `src/` — el código fuente (ver abajo).
- `README.md` — documentación para el equipo.
- `LEEME.txt` — la misma guía en texto plano, para quien no use GitHub.
- `scripts/` — utilidades de publicación.

## `src/` — el código fuente

| Archivo | Qué hace |
|---|---|
| `src/index.html` | La página original: usa módulos ES y un worker `type="module"`, así que necesita servirse por HTTP. |
| `src/js/geometry.js` | Todo el cálculo del layout, en milímetros. |
| `src/js/app.js` | Controlador de la UI, preview, render de hojas. |
| `src/js/worker.js` | Renderiza UNA hoja por canvas `OffscreenCanvas`. |
| `src/js/pdf.js` | Arma el PDF con PDFLib. |
| `src/vendor/pdf-lib.min.js` | PDFLib (MIT). |
| `src/tests/test-geometry.mjs` | 33 tests, sin navegador. |
| `src/tools/build-standalone.mjs` | Empaqueta todo en un `index.html` autocontenido. |

## Regenerar `index.html`

El `index.html` de la raíz se genera desde `src/` con:

```bash
cd src
node tools/build-standalone.mjs
cp dist/index.html ../index.html
```

Qué hace el build:

1. Fusiona `js/app.js` + `js/geometry.js` + `js/pdf.js` con `esbuild`.
2. Incrusta `vendor/pdf-lib.min.js`.
3. Convierte el Web Worker de tipo `module` en un worker clásico servido
   desde un `blob:` URL (necesario para que funcione con doble clic).

**Ojo**: bajo `file://` el navegador rechaza `import()` y los workers de
tipo `module` por CORS de origen `null`. Por eso el HTML de la raíz es
autocontenido y no una simple copia del `src/index.html`.

Si cambias el código de `src/`, hay que regenerar el HTML de la raíz y
volver a subirlo.

## Tests

```bash
cd src
node tests/test-geometry.mjs     # 33 deben pasar
```

## Publicar

```bash
bash scripts/publish-github.sh          # crea/actualiza el repo, push y activa Pages
```

El token se guarda en `~/.hermes/.env` con `scripts/save-github-token.sh`
(nunca por el chat). El push usa `credential.helper = store` con
`~/.git-credentials`.

## Privacidad

Todo el procesamiento ocurre en el navegador del usuario. La imagen nunca
sale de su equipo.
