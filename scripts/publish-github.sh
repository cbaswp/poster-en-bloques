#!/usr/bin/env bash
# Sube el repo a GitHub y activa GitHub Pages.
# Uso:  bash scripts/publish-github.sh [nombre-del-repo]
#
# Requiere: GITHUB_TOKEN en ~/.hermes/.env (ver scripts/save-github-token.sh)
set -euo pipefail

REPO_NAME="${1:-poster-en-bloques}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.hermes/.env"

# --------------------------------------------------------------- token
if [ -f "$ENV_FILE" ]; then
  GITHUB_TOKEN=$(grep -m1 '^GITHUB_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\n\r"')
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "ERROR: no hay GITHUB_TOKEN. Ejecuta primero:"
  echo "  bash scripts/save-github-token.sh"
  exit 1
fi
export GITHUB_TOKEN

# --------------------------------------------------------------- usuario
LOGIN=$(curl -s -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/user \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['login'])")
echo "Autenticado como: $LOGIN"

# --------------------------------------------------------------- crear repo
EXISTING=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/${LOGIN}/${REPO_NAME}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('yes' if d.get('id') else 'no')")

if [ "$EXISTING" = "yes" ]; then
  echo "El repo ${LOGIN}/${REPO_NAME} ya existe; se sube encima."
else
  echo "Creando repo público ${LOGIN}/${REPO_NAME}..."
  curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    https://api.github.com/user/repos \
    -d "{\"name\":\"${REPO_NAME}\",\"description\":\"Genera pósters murales desde una imagen. Todo en el navegador, la imagen nunca se sube.\",\"private\":false,\"auto_init\":false,\"has_pages\":true}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('id') else 'ERROR: '+str(d.get('message')))"
fi

# --------------------------------------------------------------- push
cd "$REPO_DIR"
git config credential.helper 'store --timeout=28800'
git remote remove origin 2>/dev/null || true
git remote add origin "https://${LOGIN}@github.com/${LOGIN}/${REPO_NAME}.git"
git push -u origin main

# Guardar el token en el credential store para futures pushes
printf 'https://%s:%s@github.com\n' "$LOGIN" "$GITHUB_TOKEN" > "$HOME/.git-credentials"
chmod 600 "$HOME/.git-credentials"

# --------------------------------------------------------------- Pages
echo
echo "Activando GitHub Pages..."
curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/${LOGIN}/${REPO_NAME}/pages" \
  -d '{"source":{"branch":"main","path":"/"}}' \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('html_url') or d.get('url'):
    print('Pages solicitado. Estado:', d.get('status', 'en cola'))
elif d.get('message') == 'Already exists':
    print('Pages ya estaba activo.')
else:
    print('Nota:', d.get('message', d))
"

echo
echo "==================================================================="
echo "  Repo:   https://github.com/${LOGIN}/${REPO_NAME}"
echo "  Pages:  https://${LOGIN}.github.io/${REPO_NAME}/"
echo
echo "  La URL de Pages tarda 1-2 minutos en estar viva."
echo "  Si no responde, revisa el estado en:"
echo "    https://github.com/${LOGIN}/${REPO_NAME}/settings/pages"
echo "==================================================================="
