#!/usr/bin/env bash
# Guarda un PAT de GitHub en ~/.hermes/.env (NO en el chat, NO en el repo).
# Uso:  bash scripts/save-github-token.sh
#
# Lee el token de la entrada estándar (oculto) o de un archivo.
set -euo pipefail

ENV_FILE="$HOME/.hermes/.env"

echo "Pega tu Personal Access Token de GitHub (no se muestra en pantalla):"
echo "  -> https://github.com/settings/tokens"
echo "  -> Generate new token (classic) -> scope 'repo' -> Generate"
echo

read -rsp "Token: " TOKEN
echo
echo

if [ -z "${TOKEN:-}" ]; then
  echo "No se entered ningun token. Abortando."
  exit 1
fi

# Validar el token contra la API antes de guardarlo
LOGIN=$(curl -s -H "Authorization: token ${TOKEN}" https://api.github.com/user \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('login','ERROR:'+d.get('message','?')))" 2>/dev/null || echo "ERROR")

case "$LOGIN" in
  ERROR*)
    echo "El token no fue aceptado por GitHub: $LOGIN"
    echo "Revisa que tenga el scope 'repo' y que no este expirado."
    exit 1
    ;;
esac

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Reemplazar cualquier GITHUB_TOKEN previo
if grep -q "^GITHUB_TOKEN=" "$ENV_FILE" 2>/dev/null; then
  python3 - "$ENV_FILE" "$TOKEN" <<'PY'
import sys
path, token = sys.argv[1], sys.argv[2]
lines = [l for l in open(path).read().splitlines() if not l.startswith('GITHUB_TOKEN=')]
lines.append(f'GITHUB_TOKEN={token}')
open(path, 'w').write('\n'.join(lines) + '\n')
PY
else
  printf 'GITHUB_TOKEN=%s\n' "$TOKEN" >> "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
echo "Token guardado en $ENV_FILE (permisos 600)."
echo "Autenticado como: $LOGIN"
