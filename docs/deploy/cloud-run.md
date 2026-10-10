# Hospedagem no Cloud Run (São Paulo)

Roteiro para publicar `apps/next` (web e API) no Cloud Run, região
`southamerica-east1`, no mesmo projeto do Firestore Enterprise (`ecofinance-912de`,
banco `ecofinance`). A escolha considera latência até o banco em São Paulo,
identidade nativa sem chave de service account e a cota gratuita do Cloud Run.

> **Dados reais.** O projeto `ecofinance-912de` contém dados financeiros reais.
> Execute cada bloco de criação conscientemente, na ordem. Os comandos são
> idempotentes: repetir um bloco não duplica recursos nem amplia permissões.
> Nunca crie nem baixe chave JSON de service account. Nunca rode `db:firebase`,
> `db:migrate`, `db:push` nem testes contra o projeto real.

## Arquitetura

```text
push na main / execução manual
  └─ GitHub Actions: deploy.yml, environment "production" (aprovação de @Ooliveiradev, só main)
       ├─ docker build (canários sintéticos + varredura do bundle do cliente)
       ├─ OIDC do GitHub → Workload Identity Federation (pool "github", provider "ecofinance-main")
       │     condição: repositório 1286486456, ref main, environment production, workflow deploy.yml
       ├─ impersona ecofinance-deploy@  (sem chave)
       ├─ push → southamerica-east1-docker.pkg.dev/ecofinance-912de/ecofinance/web
       ├─ gcloud run deploy (revisão nova sem tráfego, tag "candidate") → smoke test
       └─ tráfego 100% para a revisão nova → verificação em AUTH_URL
Cloud Run "ecofinance" executa como ecofinance-runtime@
  ├─ roles/datastore.user condicionado ao banco ecofinance (ADC pelo metadata server)
  └─ secretAccessor só em ecofinance-auth-secret (AUTH_SECRET)
```

| Recurso | Nome |
| --- | --- |
| Serviço Cloud Run | `ecofinance` (southamerica-east1) |
| Repositório Artifact Registry | `ecofinance` (Docker, tags imutáveis) |
| Imagem | `southamerica-east1-docker.pkg.dev/ecofinance-912de/ecofinance/web` |
| SA de runtime | `ecofinance-runtime@ecofinance-912de.iam.gserviceaccount.com` |
| SA de deploy | `ecofinance-deploy@ecofinance-912de.iam.gserviceaccount.com` |
| Pool / provider WIF | `github` / `ecofinance-main` |
| Secret | `ecofinance-auth-secret` (`AUTH_SECRET`) |
| Environment GitHub | `production` |

## Configuração da aplicação

| Variável | Origem | Valor |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | env do Cloud Run (`deploy.yml`) | `ecofinance-912de` |
| `FIRESTORE_DATABASE_ID` | env do Cloud Run (`deploy.yml`) | `ecofinance` |
| `AUTH_URL` | env do Cloud Run, valor da variável `AUTH_URL` do environment `production` | `https://ecofinance-<PROJECT_NUMBER>.southamerica-east1.run.app` |
| `AUTH_SECRET` | Secret Manager, versão fixada em `AUTH_SECRET_VERSION` | 64 caracteres hex aleatórios, nunca exibidos |
| `GOOGLE_APPLICATION_CREDENTIALS` | **não definir** | o SDK usa a identidade do serviço pelo metadata server |

### AUTH_URL, CORS e as URLs do Cloud Run

Conforme [cors.md](../refatoracao/cors.md), `AUTH_URL` é ao mesmo tempo a única
origem da allowlist CORS, a origem confiável do CSRF e a `baseURL` do Better Auth.
Nenhuma mudança de código é necessária. Basta que `AUTH_URL` seja a origem
canônica servida ao navegador:

- Use a URL determinística `https://ecofinance-<PROJECT_NUMBER>.southamerica-east1.run.app`.
  Ela é conhecida antes do primeiro deploy e não muda entre revisões.
- O Cloud Run também responde por uma URL legada (`https://ecofinance-<hash>-rj.a.run.app`)
  e pela URL da tag `candidate---…`. Nelas, o login e qualquer escrita pelo navegador
  recebem `403 ORIGIN_NOT_ALLOWED`/`INVALID_ORIGIN`, porque a Origin difere de
  `AUTH_URL`. O cookie é host-only e não vale entre esses hosts. Esse comportamento
  falha fechado, como esperado. Divulgue apenas `AUTH_URL`.
- Não adicione headers `Access-Control-*` em ingress ou balanceador.
- O app Expo não envia Origin e autentica por Bearer, portanto não depende da
  allowlist. Veja [App Expo](#app-expo).
- Com domínio próprio, `AUTH_URL` passa a ser o domínio. Veja
  [Domínio próprio](#domínio-próprio-opcional).

## Limites de custo e abuso (deploy.yml)

| Parâmetro | Valor | Motivo |
| --- | --- | --- |
| `--min-instances` | 0 | Sem custo ocioso; a primeira requisição tem partida a frio (atenuada por `--cpu-boost`) |
| `--max-instances` | 2 | Teto de gasto e de carga no Firestore |
| `--concurrency` | 20 | 40 requisições simultâneas no máximo; folga de memória para importações |
| `--cpu` / `--memory` | 1 / 512Mi | Next + firebase-admin + Argon2id (19 MiB por hash) |
| `--timeout` | 60s | Limita o custo de requisições lentas |
| `--cpu-throttling` | ligado | Cobrança por requisição: CPU só durante requisições |

Mudar esses valores exige PR no `deploy.yml`. O orçamento abaixo **alerta, mas não
bloqueia** gastos. A contenção real vem de `max-instances`, do limite de login
compartilhado e do [corte de emergência](#corte-de-emergência).

### PDF, fotos e OCR

A [leitura de documentos](../refatoracao/documentos.md) roda num `worker_thread` da
instância, durante a requisição de análise, com limite de 45 s (abaixo do
`--timeout`) e **uma leitura por instância**. As demais esperam até 10 s e depois
recebem "repita em instantes".

- **PDF com texto** usa poucos MiB além do Next e menos de 1 s por documento
  sintético.
- **OCR** (PDF escaneado e fotos) mede até ~250 MiB além do Next, que usa ~150 MiB
  em repouso. O servidor só inicia um OCR quando o RSS atual + 320 MiB cabe no
  limite do contêiner (`process.constrainedMemory()`). Sem essa folga, o OCR é
  recusado com orientação, sem derrubar a instância, e o PDF com texto continua
  funcionando.
- `IMPORT_OCR=off` em `--set-env-vars` desliga o OCR por completo, como corte
  rápido.
- Se recusas de OCR por memória ficarem frequentes, o ajuste é `--memory 1Gi` no
  `deploy.yml`. Isso dobra o componente de memória da cobrança por requisição;
  revise o orçamento antes do merge.

A imagem já contém pdf.js, a binding canvas, o WASM do tesseract.js e o modelo
`por`. Nada é baixado em tempo de execução. O passo "Document worker runs from the
traced standalone files" do job `container` da CI comprova isso, executado sem
rede.

## Pré-requisitos

- Use o [Cloud Shell](https://shell.cloud.google.com/?project=ecofinance-912de) (bash,
  `gcloud` autenticado e `openssl`). Os blocos abaixo usam bash. No PowerShell, as
  aspas das condições CEL mudam.
- A conta do operador precisa ser Owner do projeto ou ter os papéis de admin de
  Service Usage, IAM, Workload Identity Pools, Artifact Registry, Cloud Run e
  Secret Manager. O orçamento também exige Billing Account Administrator.
- O faturamento já está ativo, porque o Firestore Enterprise o exige.
- Use `gh` autenticado como @Ooliveiradev para as variáveis do environment. Pode ser
  na máquina local.

### 0. Variáveis da sessão

```bash
set -euo pipefail
export PROJECT_ID=ecofinance-912de
export REGION=southamerica-east1
export SERVICE=ecofinance
export REPOSITORY=ecofinance
export DATABASE_ID=ecofinance
export POOL=github
export PROVIDER=ecofinance-main
export GITHUB_REPO=Ooliveiradev/EcoFinance
export GITHUB_REPO_ID=1286486456      # gh api repos/Ooliveiradev/EcoFinance -q .id
export GITHUB_OWNER_ID=179396091      # gh api users/Ooliveiradev -q .id
export RUNTIME_SA="ecofinance-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
export DEPLOY_SA="ecofinance-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
export SECRET=ecofinance-auth-secret
gcloud config set project "$PROJECT_ID"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export AUTH_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
echo "$AUTH_URL"
```

`gcloud config set project` altera só a configuração local do Cloud Shell.

### 1. Conferência só de leitura

```bash
gcloud projects describe "$PROJECT_ID" --format='value(projectId,projectNumber,lifecycleState)'
gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled,billingAccountName)'
gcloud firestore databases describe --database="$DATABASE_ID" --format='value(name,locationId,type,databaseEdition)'
gcloud services list --enabled --format='value(config.name)' | sort
gcloud iam service-accounts list --format='value(email)'
```

O banco deve aparecer em `southamerica-east1`.

### 2. APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  cloudresourcemanager.googleapis.com \
  billingbudgets.googleapis.com
```

### 3. Artifact Registry

```bash
gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker --location="$REGION" --immutable-tags \
    --description="Imagens do EcoFinance para o Cloud Run"

# Mantém as 5 imagens mais recentes (janela de rollback) e apaga o restante após 30 dias.
cat > /tmp/ecofinance-cleanup.json <<'EOF'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "30d"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies "$REPOSITORY" --location="$REGION" \
  --policy=/tmp/ecofinance-cleanup.json --no-dry-run
```

### 4. Service accounts

```bash
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create ecofinance-runtime \
    --display-name="EcoFinance Cloud Run runtime" \
    --description="Identidade do serviço ecofinance: Firestore ecofinance e AUTH_SECRET"
gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 ||
  gcloud iam service-accounts create ecofinance-deploy \
    --display-name="EcoFinance deploy (GitHub Actions)" \
    --description="Impersonada só pelo deploy.yml da main via Workload Identity Federation"
```

### 5. Secret AUTH_SECRET

O valor é gerado e enviado direto ao Secret Manager, sem aparecer na tela nem em
arquivo.

```bash
gcloud secrets describe "$SECRET" >/dev/null 2>&1 ||
  gcloud secrets create "$SECRET" --replication-policy=user-managed --locations="$REGION"
if [ -z "$(gcloud secrets versions list "$SECRET" --filter='state=ENABLED' --limit=1 --format='value(name)')" ]; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add "$SECRET" --data-file=-
fi
export AUTH_SECRET_VERSION="$(gcloud secrets versions list "$SECRET" --filter='state=ENABLED' \
  --sort-by='~createTime' --limit=1 --format='value(name.basename())')"
echo "AUTH_SECRET_VERSION=$AUTH_SECRET_VERSION"
```

### 6. IAM da identidade de runtime

```bash
# Firestore: somente o banco ecofinance, sem papel de administração.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/datastore.user \
  --condition="expression=resource.name == \"projects/${PROJECT_ID}/databases/${DATABASE_ID}\",title=ecofinance-database-only,description=Somente o banco ecofinance"

# Secret Manager: somente o AUTH_SECRET.
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor
```

### 7. Workload Identity Federation (GitHub → GCP)

Só emite credencial para um token OIDC do repositório `Ooliveiradev/EcoFinance`,
verificado pelo ID numérico, que resiste a renomeação ou recriação. O token também
precisa vir da branch `main`, do environment `production` e do workflow
`deploy.yml`. PRs, forks, outras branches e outros workflows são recusados pelo STS.

```bash
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.workflow_ref=assertion.workflow_ref"
CONDITION="assertion.repository_id == '${GITHUB_REPO_ID}' && assertion.repository_owner_id == '${GITHUB_OWNER_ID}' && assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production' && assertion.workflow_ref == '${GITHUB_REPO}/.github/workflows/deploy.yml@refs/heads/main'"

gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions" --description="OIDC do GitHub Actions"

if gcloud iam workload-identity-pools providers describe "$PROVIDER" \
     --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  # Reaplica mapeamento e condição: o estado final é sempre o deste documento.
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --display-name="EcoFinance main" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi

# Só identidades desse repositório (já filtradas pela condição) podem impersonar a SA de deploy.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_id/${GITHUB_REPO_ID}"
```

Pools e providers apagados ficam 30 dias em exclusão reversível e bloqueiam o nome.
Use `undelete` em vez de recriar.

### 8. IAM da identidade de deploy

```bash
# Cria revisões e muda tráfego. Não altera IAM, portanto não consegue tornar outro serviço público.
# --condition=None: a política do projeto já tem binding condicional (passo 6).
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/run.developer --condition=None

# Pode publicar revisões que executam somente como a SA de runtime.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/iam.serviceAccountUser

# Push apenas no repositório ecofinance.
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" \
  --member="serviceAccount:${DEPLOY_SA}" --role=roles/artifactregistry.writer
```

A SA de deploy não lê secrets nem o Firestore. Quem lê o secret ao iniciar a
instância é a SA de runtime.

### 9. Serviço inicial e acesso público

O workflow publica cada revisão sem tráfego e só então a promove. Para isso, o
serviço precisa existir. A criação inicial usa a imagem de exemplo oficial,
fixada por digest, sem variáveis nem secrets. O acesso público é concedido uma
única vez pelo operador, porque a SA de deploy não pode alterar IAM. A autenticação
do app (sessão, CSRF, ownership) continua obrigatória em cada rota.

```bash
gcloud run services describe "$SERVICE" --region="$REGION" >/dev/null 2>&1 ||
  gcloud run deploy "$SERVICE" --region="$REGION" \
    --image=us-docker.pkg.dev/cloudrun/container/hello@sha256:ea86b59c787261f424f9de114900e598f19e036c73aa95ff12b6ad5f022122fd \
    --service-account="$RUNTIME_SA" --min-instances=0 --max-instances=1 \
    --no-allow-unauthenticated --quiet

gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker

curl -s -o /dev/null -w '%{http_code}\n' "$AUTH_URL"   # 200 (página de exemplo)
```

Sem organização no projeto, nenhuma política de compartilhamento restrito bloqueia
`allUsers`. Se uma política assim existir, `add-iam-policy-binding` vai falhar.
Nesse caso, avalie `--no-invoker-iam-check` com o administrador.

### 10. Environment `production` no GitHub

O environment já existe, com @Ooliveiradev como revisor obrigatório, sem bypass de
admin e com deploy só da branch `main`. Para reproduzir:

```bash
gh api -X PUT repos/Ooliveiradev/EcoFinance/environments/production --input - <<'EOF'
{"wait_timer": 0, "prevent_self_review": false, "can_admins_bypass": false,
 "reviewers": [{"type": "User", "id": 179396091}],
 "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
EOF
gh api repos/Ooliveiradev/EcoFinance/environments/production/deployment-branch-policies \
  -q '.branch_policies[].name' | grep -qx main ||
  gh api -X POST repos/Ooliveiradev/EcoFinance/environments/production/deployment-branch-policies \
    -f name=main -f type=branch
```

`prevent_self_review` fica desligado porque o único revisor também é quem faz o
merge. Variáveis do environment (não são segredos, por isso ficam em `vars`):

```bash
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$GITHUB_REPO" --env production \
  --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
gh variable set AUTH_URL --repo "$GITHUB_REPO" --env production --body "$AUTH_URL"
gh variable set AUTH_SECRET_VERSION --repo "$GITHUB_REPO" --env production --body "$AUTH_SECRET_VERSION"
```

Se o `gh` não estiver no Cloud Shell, rode estes três comandos localmente com os
valores impressos nos passos 0 e 5. O formato é validado pelo primeiro passo do
workflow.

### 11. Primeiro deploy

1. Faça o merge do PR na `main`. O push dispara o `Deploy`. Também é possível rodar
   manualmente em **Actions → Deploy → Run workflow** (branch `main`).
2. Aprove em **Review deployments**. Sem aprovação, nada acessa o GCP.
3. O workflow:
   - valida as variáveis;
   - faz o build da imagem com canários;
   - autentica por WIF e publica a imagem;
   - cria a revisão sem tráfego (`candidate`) e testa `/api/health` e `/login` nela;
   - promove 100% do tráfego e confere `AUTH_URL/api/health`.
4. Valide com dados sintéticos os comandos de CORS de [cors.md](../refatoracao/cors.md#procedimento)
   usando `$base = AUTH_URL`.
5. Crie o primeiro acesso conforme [autenticacao.md](../refatoracao/autenticacao.md)
   (JSON por stdin, executado pelo mantenedor). Não há cadastro público.

Cada push na `main` gera um novo pedido de aprovação. Rejeitar o pedido não altera
nada em produção.

## Rollback

As revisões antigas continuam disponíveis. As imagens das 5 últimas publicações
ficam retidas pela política de limpeza.

```bash
gcloud run revisions list --service="$SERVICE" --region="$REGION" \
  --format='table(metadata.name,metadata.labels.commit,status.conditions[0].status,metadata.creationTimestamp)'
# Volta 100% do tráfego para uma revisão anterior (efeito imediato, sem build):
gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-revisions=ecofinance-00012-abc=100
```

- O próximo deploy aprovado volta a promover a revisão mais nova. Enquanto a correção
  não estiver pronta, rejeite os pedidos de aprovação.
- O rollback troca só o código. Os dados do Firestore não voltam. Antes de reverter
  uma revisão que mudou formato de dados, siga backup e restauração em
  [firebase-migration.md](../refatoracao/firebase-migration.md).

### Corte de emergência

```bash
# Torna o serviço privado na hora: toda requisição pública recebe 403 do Google.
gcloud run services remove-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker
# Reabrir: repita o add-iam-policy-binding do passo 9.
```

## Rotação do AUTH_SECRET

```bash
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add "$SECRET" --data-file=-
gcloud secrets versions list "$SECRET"            # anote a nova versão N
gh variable set AUTH_SECRET_VERSION --repo "$GITHUB_REPO" --env production --body N
# Rode o workflow Deploy (manual) e aprove. Depois desative a versão anterior:
gcloud secrets versions disable <N-1> --secret="$SECRET"
```

A versão fica fixada na revisão, então todas as instâncias usam o mesmo segredo.
Trocar o segredo invalida as sessões web e os tokens do Expo. Todos entram de novo.

## Orçamento e alerta de billing

```bash
BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName.basename())')"
gcloud billing accounts describe "$BILLING_ACCOUNT" --format='value(currencyCode)'   # moeda do orçamento
BUDGET_AMOUNT=50BRL   # use a moeda da conta, por exemplo 10USD
gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
  --filter="displayName='EcoFinance mensal'" --format='value(name)' | grep -q . ||
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
    --display-name="EcoFinance mensal" --budget-amount="$BUDGET_AMOUNT" \
    --filter-projects="projects/${PROJECT_NUMBER}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 --threshold-rule=percent=1.0,basis=forecasted-spend
```

Os alertas vão por e-mail aos administradores de billing. O orçamento cobre o
projeto inteiro, incluindo o Firestore. Custos esperados:

- Cloud Run com cobrança por requisição tem uma
  [camada gratuita mensal](https://cloud.google.com/run/pricing) de vCPU-s, GiB-s e
  requisições.
- Artifact Registry tem 0,5 GB gratuitos, e a política de limpeza mantém poucas imagens.
- Secret Manager cobra por versão ativa e por acesso. Uma versão é lida em cada
  partida de instância.
- Tráfego do Artifact Registry para o Cloud Run na mesma região não é cobrado.
- Confira os preços da região antes de ampliar os limites.

## Domínio próprio (opcional)

- O **mapeamento de domínio do Cloud Run não existe em southamerica-east1**. Ele está
  em preview e disponível em [10 regiões](https://cloud.google.com/run/docs/mapping-custom-domains).
- O **Firebase Hosting com rewrite para o Cloud Run não serve**: ele remove todos os
  cookies exceto `__session` ([documentação](https://firebase.google.com/docs/hosting/manage-cache)).
  Isso descartaria o cookie de sessão do Better Auth e quebraria o login web.
- A opção suportada é o **Application Load Balancer externo global** com NEG
  serverless e certificado gerenciado. O forwarding rule tem custo fixo mensal
  (consulte [preços](https://cloud.google.com/vpc/network-pricing#lb)), que fica
  acima da cota gratuita do Cloud Run.

```bash
export DOMAIN=financas.exemplo.com.br   # substitua
gcloud services enable compute.googleapis.com
gcloud compute addresses describe ecofinance-ip --global >/dev/null 2>&1 ||
  gcloud compute addresses create ecofinance-ip --global
gcloud compute network-endpoint-groups describe ecofinance-neg --region="$REGION" >/dev/null 2>&1 ||
  gcloud compute network-endpoint-groups create ecofinance-neg --region="$REGION" \
    --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
gcloud compute backend-services describe ecofinance-backend --global >/dev/null 2>&1 || {
  gcloud compute backend-services create ecofinance-backend --global --load-balancing-scheme=EXTERNAL_MANAGED
  gcloud compute backend-services add-backend ecofinance-backend --global \
    --network-endpoint-group=ecofinance-neg --network-endpoint-group-region="$REGION"
}
gcloud compute url-maps describe ecofinance-urlmap >/dev/null 2>&1 ||
  gcloud compute url-maps create ecofinance-urlmap --default-service=ecofinance-backend
gcloud compute ssl-certificates describe ecofinance-cert --global >/dev/null 2>&1 ||
  gcloud compute ssl-certificates create ecofinance-cert --domains="$DOMAIN" --global
gcloud compute target-https-proxies describe ecofinance-https >/dev/null 2>&1 ||
  gcloud compute target-https-proxies create ecofinance-https \
    --url-map=ecofinance-urlmap --ssl-certificates=ecofinance-cert
gcloud compute forwarding-rules describe ecofinance-https-rule --global >/dev/null 2>&1 ||
  gcloud compute forwarding-rules create ecofinance-https-rule --global \
    --load-balancing-scheme=EXTERNAL_MANAGED --address=ecofinance-ip \
    --target-https-proxy=ecofinance-https --ports=443
gcloud compute addresses describe ecofinance-ip --global --format='value(address)'   # registro A do DNS
```

Depois que o certificado ficar `ACTIVE` (`gcloud compute ssl-certificates describe ecofinance-cert --global`):

1. Mude a variável `AUTH_URL` do environment para `https://$DOMAIN` e rode o deploy.
   A allowlist CORS, o CSRF e o Better Auth passam a aceitar só o domínio.
2. Atualize a URL no Expo.
3. As URLs `run.app` continuam respondendo, mas recusam login e escrita do navegador
   (Origin diferente). Restringir o ingress a `internal-and-cloud-load-balancing`
   exige PR no `deploy.yml`: o flag `--ingress` e o smoke test, que usa a URL da tag
   em `run.app`.

## App Expo

O app nativo não usa CORS. Ele envia `Authorization: Bearer` e nenhuma Origin, e
só aceita HTTPS fora do emulador
([backend-config.ts](../../apps/expo/src/services/backend-config.ts)).

- **Build:** defina `EXPO_PUBLIC_API_URL` com o valor de `AUTH_URL` (sem barra final),
  em `apps/expo/.env` local (fora do Git) ou como variável de ambiente do EAS
  com visibilidade `plaintext`.
  É um endereço público, não um segredo.
- **Sem rebuild:** a tela de login aceita a URL digitada, que fica salva no SecureStore
  junto com a sessão.
- Se `AUTH_URL` mudar para um domínio próprio, troque a URL no app e entre de novo.

## Verificação do estado

```bash
gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
  --filter='bindings.members:ecofinance-' --format='table(bindings.role,bindings.members,bindings.condition.title)'
gcloud iam service-accounts get-iam-policy "$DEPLOY_SA"
gcloud iam service-accounts get-iam-policy "$RUNTIME_SA"
gcloud secrets get-iam-policy "$SECRET"
gcloud run services get-iam-policy "$SERVICE" --region="$REGION"
gcloud iam service-accounts keys list --iam-account="$RUNTIME_SA" --managed-by=user   # deve ser vazio
gcloud iam service-accounts keys list --iam-account="$DEPLOY_SA" --managed-by=user    # deve ser vazio
gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='yaml(spec.template.spec.serviceAccountName,spec.template.metadata.annotations,spec.traffic)'
```

## Imagem

- O [Dockerfile](../../Dockerfile) tem duas etapas. Ambas usam `node:22-bookworm-slim`
  fixado por digest, e o Dependabot propõe atualizações.
- O build roda `scripts/security/build-with-canaries.mjs web`, o mesmo da CI.
- O runtime contém só o standalone com `.next/static` e `public`, sem npm, corepack,
  fontes nem `.env`. Executa como `node` (não-root), com o código somente leitura.
- O `HEALTHCHECK` em `/api/health` vale para `docker run` e para o job `container` da
  CI. O Cloud Run usa os próprios probes (TCP na porta 8080), e o workflow testa
  `/api/health` antes de promover a revisão.
- O [.dockerignore](../../.dockerignore) é uma allowlist. Excluem-se `.env*`, dados
  locais (`.local-*`), `.ci-diagnostics`, testes, Expo e o arquivo de credencial
  temporário do `google-github-actions/auth`.

Teste local, com Docker e dados sintéticos:

```bash
docker build -t ecofinance-web .
docker run --rm -p 3000:8080 -e AUTH_URL=http://localhost:3000 -e AUTH_SECRET="$(openssl rand -hex 32)" \
  -e FIREBASE_PROJECT_ID=demo-ecofinance -e FIRESTORE_DATABASE_ID=ecofinance \
  -e FIRESTORE_EMULATOR_HOST=host.docker.internal:8080 ecofinance-web
```
