#!/usr/bin/env bash
# Provisiona o Cloud Run do EcoFinance em um único comando (passos 0–10 de
# docs/deploy/cloud-run.md). Feito para o Cloud Shell do projeto ecofinance-912de.
#
#   bash scripts/deploy/provision-gcp.sh --check   # só leitura: mostra o que falta
#   bash scripts/deploy/provision-gcp.sh           # cria/ajusta, após confirmação
#   BUDGET_AMOUNT=50BRL bash scripts/deploy/provision-gcp.sh   # também cria o orçamento
#
# Idempotente: repetir não duplica recursos nem amplia permissões. Nunca cria chave
# de service account, nunca exibe o AUTH_SECRET e não lê nem grava no Firestore.
set -euo pipefail

MODE=apply
case "${1:-}" in
  --check) MODE=check ;;
  --yes) MODE=yes ;;
  '') ;;
  *) echo "Uso: $0 [--check|--yes]" >&2; exit 2 ;;
esac

PROJECT_ID=ecofinance-912de
REGION=southamerica-east1
SERVICE=ecofinance
REPOSITORY=ecofinance
DATABASE_ID=ecofinance
POOL=github
PROVIDER=ecofinance-main
GITHUB_REPO=Ooliveiradev/EcoFinance
GITHUB_REPO_ID=1286486456
GITHUB_OWNER_ID=179396091
RUNTIME_SA="ecofinance-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="ecofinance-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
SECRET=ecofinance-auth-secret
HELLO_IMAGE=us-docker.pkg.dev/cloudrun/container/hello@sha256:ea86b59c787261f424f9de114900e598f19e036c73aa95ff12b6ad5f022122fd
APIS=(run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com
  sts.googleapis.com secretmanager.googleapis.com cloudresourcemanager.googleapis.com billingbudgets.googleapis.com)

step() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
status() { printf '  %-34s %s\n' "$1" "$2"; }
exists() { "$@" >/dev/null 2>&1; }

command -v gcloud >/dev/null || { echo "gcloud não encontrado. Use o Cloud Shell: https://shell.cloud.google.com/?project=${PROJECT_ID}" >&2; exit 1; }
gcloud config set project "$PROJECT_ID" --quiet >/dev/null 2>&1
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
AUTH_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

step "Conferência (somente leitura)"
status "Projeto" "$PROJECT_ID ($PROJECT_NUMBER)"
status "Conta do operador" "$(gcloud config get-value account 2>/dev/null)"
status "Faturamento ativo" "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null || echo '?')"
database="$(gcloud firestore databases describe --database="$DATABASE_ID" --format='value(locationId,databaseEdition)' 2>/dev/null || true)"
status "Banco Firestore" "${database:-NÃO ENCONTRADO}"
enabled="$(gcloud services list --enabled --format='value(config.name)')"
missing_apis=()
for api in "${APIS[@]}"; do grep -qx "$api" <<<"$enabled" || missing_apis+=("$api"); done
status "APIs faltando" "${missing_apis[*]:-nenhuma}"
check() { if exists "${@:2}"; then status "$1" ok; else status "$1" falta; fi; }
check "Artifact Registry" gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION"
check "SA de runtime" gcloud iam service-accounts describe "$RUNTIME_SA"
check "SA de deploy" gcloud iam service-accounts describe "$DEPLOY_SA"
check "Secret AUTH_SECRET" gcloud secrets describe "$SECRET"
check "Pool WIF" gcloud iam workload-identity-pools describe "$POOL" --location=global
check "Provider WIF" gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL"
check "Serviço Cloud Run" gcloud run services describe "$SERVICE" --region="$REGION"
status "AUTH_URL" "$AUTH_URL"

if [ "$MODE" = check ]; then echo; echo "Modo --check: nada foi alterado."; exit 0; fi
[ -n "$database" ] || { echo "Banco Firestore '${DATABASE_ID}' não encontrado no projeto; confira a conta e o projeto antes de provisionar." >&2; exit 1; }

if [ "$MODE" = apply ]; then
  cat <<EOF

Isto vai criar/ajustar no projeto REAL ${PROJECT_ID}: APIs, Artifact Registry,
duas service accounts sem chave, o secret AUTH_SECRET, IAM mínimo, Workload Identity
Federation restrita à main/production/deploy.yml e o serviço Cloud Run público
(a autenticação do app continua obrigatória). O Firestore não é tocado.
EOF
  read -r -p "Digite PROVISIONAR para continuar: " answer
  [ "$answer" = PROVISIONAR ] || { echo "Cancelado; nada foi alterado."; exit 1; }
fi

step "APIs"
[ ${#missing_apis[@]} -eq 0 ] || gcloud services enable "${missing_apis[@]}"

step "Artifact Registry"
exists gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" ||
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker --location="$REGION" --immutable-tags \
    --description="Imagens do EcoFinance para o Cloud Run"
cleanup="$(mktemp)"
trap 'rm -f "$cleanup"' EXIT
cat >"$cleanup" <<'EOF'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "30d"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" --location="$REGION" \
  --policy="$cleanup" --no-dry-run --quiet >/dev/null

step "Service accounts"
exists gcloud iam service-accounts describe "$RUNTIME_SA" ||
  gcloud iam service-accounts create ecofinance-runtime \
    --display-name="EcoFinance Cloud Run runtime" \
    --description="Identidade do serviço ecofinance: Firestore ecofinance e AUTH_SECRET"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create ecofinance-deploy \
    --display-name="EcoFinance deploy (GitHub Actions)" \
    --description="Impersonada só pelo deploy.yml da main via Workload Identity Federation"

step "Secret AUTH_SECRET (valor gerado direto no Secret Manager, nunca exibido)"
exists gcloud secrets describe "$SECRET" ||
  gcloud secrets create "$SECRET" --replication-policy=user-managed --locations="$REGION"
if [ -z "$(gcloud secrets versions list "$SECRET" --filter='state=ENABLED' --limit=1 --format='value(name)')" ]; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add "$SECRET" --data-file=-
fi
AUTH_SECRET_VERSION="$(gcloud secrets versions list "$SECRET" --filter='state=ENABLED' \
  --sort-by='~createTime' --limit=1 --format='value(name.basename())')"

step "IAM da identidade de runtime"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/datastore.user \
  --condition="expression=resource.name == \"projects/${PROJECT_ID}/databases/${DATABASE_ID}\",title=ecofinance-database-only,description=Somente o banco ecofinance" \
  --quiet >/dev/null
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor --quiet >/dev/null

step "Workload Identity Federation (GitHub → GCP)"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref"
CONDITION="assertion.repository_id == '${GITHUB_REPO_ID}' && assertion.repository_owner_id == '${GITHUB_OWNER_ID}' && assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production' && assertion.workflow_ref == '${GITHUB_REPO}/.github/workflows/deploy.yml@refs/heads/main'"
exists gcloud iam workload-identity-pools describe "$POOL" --location=global ||
  gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions" --description="OIDC do GitHub Actions"
if exists gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL"; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION" --quiet >/dev/null
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --display-name="EcoFinance main" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_id/${GITHUB_REPO_ID}" \
  --quiet >/dev/null

step "IAM da identidade de deploy"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/run.developer --condition=None --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser --quiet >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/artifactregistry.writer --quiet >/dev/null

step "Serviço inicial e acesso público"
exists gcloud run services describe "$SERVICE" --region="$REGION" ||
  gcloud run deploy "$SERVICE" --region="$REGION" --image="$HELLO_IMAGE" \
    --service-account="$RUNTIME_SA" --min-instances=0 --max-instances=1 \
    --no-allow-unauthenticated --quiet
gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker --quiet >/dev/null
status "HTTP em AUTH_URL" "$(curl -s -o /dev/null -w '%{http_code}' "$AUTH_URL" || true)"

if [ -n "${BUDGET_AMOUNT:-}" ]; then
  step "Orçamento mensal (alerta, não bloqueia)"
  BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName.basename())')"
  gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
    --filter="displayName='EcoFinance mensal'" --format='value(name)' | grep -q . ||
    gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
      --display-name="EcoFinance mensal" --budget-amount="$BUDGET_AMOUNT" \
      --filter-projects="projects/${PROJECT_NUMBER}" \
      --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 \
      --threshold-rule=percent=1.0 --threshold-rule=percent=1.0,basis=forecasted-spend
fi

step "Variáveis do environment production no GitHub"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$GITHUB_REPO" --env production --body "$WIF_PROVIDER"
  gh variable set AUTH_URL --repo "$GITHUB_REPO" --env production --body "$AUTH_URL"
  gh variable set AUTH_SECRET_VERSION --repo "$GITHUB_REPO" --env production --body "$AUTH_SECRET_VERSION"
  echo "Variáveis gravadas."
else
  cat <<EOF
gh não autenticado aqui. Rode na sua máquina (valores públicos, não são segredos):

gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo $GITHUB_REPO --env production --body "$WIF_PROVIDER"
gh variable set AUTH_URL --repo $GITHUB_REPO --env production --body "$AUTH_URL"
gh variable set AUTH_SECRET_VERSION --repo $GITHUB_REPO --env production --body "$AUTH_SECRET_VERSION"
EOF
fi

cat <<EOF

Pronto. Próximos passos:
  1. GitHub → Actions → Deploy → Run workflow (main) e aprove em "Review deployments".
  2. Crie seu acesso: bash scripts/deploy/first-user.sh
  3. Abra ${AUTH_URL}
EOF
