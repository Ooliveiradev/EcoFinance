#!/usr/bin/env bash
# Autoriza o projeto Vercel "ecofinance" (só o ambiente Production) a acessar o banco
# Firestore "ecofinance" sem chave, via Workload Identity Federation (docs/deploy/vercel.md).
# Feito para o Cloud Shell do projeto ecofinance-912de:
#
#   bash scripts/deploy/provision-vercel-gcp.sh --check   # só leitura
#   bash scripts/deploy/provision-vercel-gcp.sh           # aplica, após confirmação
#
# Idempotente. Nunca cria chave de service account e não lê nem grava no Firestore.
set -euo pipefail

MODE=apply
case "${1:-}" in
  --check) MODE=check ;;
  --yes) MODE=yes ;;
  '') ;;
  *) echo "Uso: $0 [--check|--yes]" >&2; exit 2 ;;
esac

PROJECT_ID=ecofinance-912de
DATABASE_ID=ecofinance
VERCEL_TEAM=${VERCEL_TEAM:-ooliveiradevs-projects}
VERCEL_PROJECT=${VERCEL_PROJECT:-ecofinance}
POOL=vercel
PROVIDER=ecofinance
RUNTIME_SA="ecofinance-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
ISSUER="https://oidc.vercel.com/${VERCEL_TEAM}"
AUDIENCE="https://vercel.com/${VERCEL_TEAM}"
SUBJECT="owner:${VERCEL_TEAM}:project:${VERCEL_PROJECT}:environment:production"

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
status() { printf '  %-28s %s\n' "$1" "$2"; }
exists() { "$@" >/dev/null 2>&1; }
check() { if exists "${@:2}"; then status "$1" ok; else status "$1" falta; fi; }

command -v gcloud >/dev/null || { echo "gcloud não encontrado. Use o Cloud Shell: https://shell.cloud.google.com/?project=${PROJECT_ID}" >&2; exit 1; }
gcloud config set project "$PROJECT_ID" --quiet >/dev/null 2>&1
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

step "Conferência (somente leitura)"
status "Projeto" "$PROJECT_ID ($PROJECT_NUMBER)"
status "Conta do operador" "$(gcloud config get-value account 2>/dev/null)"
database="$(gcloud firestore databases describe --database="$DATABASE_ID" --format='value(locationId)' 2>/dev/null || true)"
status "Banco Firestore" "${database:-NÃO ENCONTRADO}"
check "SA de runtime" gcloud iam service-accounts describe "$RUNTIME_SA"
check "Pool WIF vercel" gcloud iam workload-identity-pools describe "$POOL" --location=global
check "Provider WIF" gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL"
status "Identidade aceita" "$SUBJECT"

if [ "$MODE" = check ]; then echo; echo "Modo --check: nada foi alterado."; exit 0; fi
[ -n "$database" ] || { echo "Banco Firestore '${DATABASE_ID}' não encontrado; confira a conta e o projeto." >&2; exit 1; }

if [ "$MODE" = apply ]; then
  cat <<EOF

Isto vai criar/ajustar no projeto REAL ${PROJECT_ID}: APIs de IAM/STS, a service account
ecofinance-runtime (sem chave) com acesso só ao banco ${DATABASE_ID}, e uma federação
que aceita apenas tokens da Vercel de ${VERCEL_TEAM}/${VERCEL_PROJECT} em Production.
Previews, outros projetos e outros times são recusados pelo Google.
EOF
  read -r -p "Digite PROVISIONAR para continuar: " answer
  [ "$answer" = PROVISIONAR ] || { echo "Cancelado; nada foi alterado."; exit 1; }
fi

step "APIs"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com

step "Service account de runtime"
exists gcloud iam service-accounts describe "$RUNTIME_SA" ||
  gcloud iam service-accounts create ecofinance-runtime \
    --display-name="EcoFinance runtime" \
    --description="Identidade da web do EcoFinance: somente o banco Firestore ecofinance"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/datastore.user \
  --condition="expression=resource.name == \"projects/${PROJECT_ID}/databases/${DATABASE_ID}\",title=ecofinance-database-only,description=Somente o banco ecofinance" \
  --quiet >/dev/null

step "Workload Identity Federation (Vercel → GCP)"
exists gcloud iam workload-identity-pools describe "$POOL" --location=global ||
  gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="Vercel" --description="OIDC da Vercel (${VERCEL_TEAM})"
CONDITION="assertion.sub == '${SUBJECT}'"
MAPPING="google.subject=assertion.sub,attribute.project=assertion.project,attribute.environment=assertion.environment"
if exists gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL"; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="$ISSUER" --allowed-audiences="$AUDIENCE" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --quiet >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --display-name="EcoFinance production" \
    --issuer-uri="$ISSUER" --allowed-audiences="$AUDIENCE" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi
# Só o sujeito exato (projeto + Production) pode se passar pela SA de runtime.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/subject/${SUBJECT}" \
  --quiet >/dev/null

cat <<EOF

Pronto. Variáveis do projeto Vercel (ambiente Production; valores públicos, não são segredos):

  GCP_WORKLOAD_IDENTITY_PROVIDER=${WIF_PROVIDER}
  GCP_SERVICE_ACCOUNT_EMAIL=${RUNTIME_SA}

Depois crie seu acesso: bash scripts/deploy/first-user.sh
EOF
