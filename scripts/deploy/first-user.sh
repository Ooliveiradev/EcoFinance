#!/usr/bin/env bash
# Cria (ou recupera) um acesso no Firestore de produção, sem cadastro público.
# Feito para o Cloud Shell do projeto ecofinance-912de, na raiz do repositório:
#
#   bash scripts/deploy/first-user.sh           # novo acesso
#   bash scripts/deploy/first-user.sh --reset   # nova senha para email existente
#
# A senha é lida sem eco e segue só por stdin até apps/next/scripts/user.ts: nunca vai para
# argumento, variável de ambiente, arquivo ou histórico (docs/refatoracao/autenticacao.md).
set -euo pipefail

RESET=false
case "${1:-}" in
  --reset) RESET=true ;;
  '') ;;
  *) echo "Uso: $0 [--reset]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/../.."
[ -f apps/next/scripts/user.ts ] || { echo "Rode a partir de um clone do EcoFinance." >&2; exit 1; }

major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$major" -lt 22 ]; then
  echo "Node 22+ necessário (atual: $(node -v 2>/dev/null || echo nenhum)). No Cloud Shell: nvm install 22 && nvm use 22" >&2
  exit 1
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
echo "Instalando dependências da web (só na primeira vez demora)..."
corepack pnpm install --frozen-lockfile --filter '@ecofinance/next...' --reporter=silent

read -r -p "Email de login: " email
name=""
$RESET || read -r -p "Nome: " name
read -r -s -p "Senha (12 a 128 caracteres): " password; echo
read -r -s -p "Repita a senha: " confirm; echo
[ "$password" = "$confirm" ] || { echo "As senhas não conferem." >&2; exit 1; }
unset confirm

export FIREBASE_PROJECT_ID=ecofinance-912de FIRESTORE_DATABASE_ID=ecofinance
unset FIRESTORE_EMULATOR_HOST GOOGLE_APPLICATION_CREDENTIALS

# printf é builtin: a senha não aparece na lista de processos.
if ! printf '%s\0%s\0%s\0%s' "$email" "$name" "$password" "$RESET" |
  node -e '
    const [email, name, password, reset] = require("fs").readFileSync(0, "utf8").split("\0");
    process.stdout.write(JSON.stringify(reset === "true" ? { email, password, reset: true } : { email, password, ...(name ? { name } : {}) }));
  ' | corepack pnpm --silent --filter @ecofinance/next auth:user; then
  cat >&2 <<'EOF'
Se o erro for de credencial, autorize o acesso ao Firestore e repita:
  gcloud auth application-default login
  gcloud auth application-default set-quota-project ecofinance-912de
EOF
  exit 1
fi
unset password
