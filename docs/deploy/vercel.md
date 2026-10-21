# Hospedagem na Vercel (São Paulo)

A web (`apps/next`) roda na Vercel, região `gru1` (São Paulo), perto do Firestore
Enterprise `ecofinance` do projeto `ecofinance-912de`. O [Cloud Run](cloud-run.md)
continua documentado como alternativa, com o workflow `Deploy` só manual.

> **Dados reais.** O Firestore de produção contém dados financeiros reais. Nunca crie
> nem baixe chave JSON de service account, nem rode seed, migrações ou testes contra ele.

## Arquitetura

```text
push na main ── Vercel (Git) ── build de apps/next ── deploy Production (gru1)
                                    │
função ── token OIDC da Vercel ── STS do Google (pool "vercel", provider "ecofinance")
          sub = owner:ooliveiradevs-projects:project:ecofinance:environment:production
                                    │
             token curto de ecofinance-runtime@ ── Firestore, só o banco ecofinance
```

- **Sem chave:** a função troca o token OIDC que a Vercel injeta em cada requisição por
  um token de curta duração da SA `ecofinance-runtime`
  ([vercel-credentials.ts](../../packages/db/src/vercel-credentials.ts)). A configuração
  incompleta ou malformada falha fechado, sem cair em outra credencial.
- **Só Production:** o Google aceita apenas o `sub` do projeto `ecofinance` no ambiente
  Production. Previews, outros projetos e outros times recebem recusa do STS. As previews
  também ficam desligadas no projeto e as variáveis existem só em Production.
- **Mínimo privilégio:** a SA tem `roles/datastore.user` condicionado ao banco `ecofinance`
  e nada mais.

## Variáveis (Production)

| Variável | Tipo | Valor |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | texto | `ecofinance-912de` |
| `FIRESTORE_DATABASE_ID` | texto | `ecofinance` |
| `AUTH_URL` | texto | `https://ecofinance-ooliveiradev.vercel.app` (domínio de produção fixo do projeto, sem barra final) |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | texto | impresso pelo script: `projects/<número>/locations/global/workloadIdentityPools/vercel/providers/ecofinance` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | texto | `ecofinance-runtime@ecofinance-912de.iam.gserviceaccount.com` |
| `AUTH_SECRET` | **Sensitive** | 64 caracteres hex aleatórios, criado por você no painel |

`AUTH_URL` é a única origem aceita por CORS, CSRF e Better Auth ([cors.md](../refatoracao/cors.md)).
Login e escrita pelas URLs de deployment (`ecofinance-<hash>-….vercel.app`) recebem 403,
como esperado. Divulgue só o domínio de produção.

## Passo a passo

1. **GCP (Cloud Shell):**

   ```bash
   git clone https://github.com/Ooliveiradev/EcoFinance.git && cd EcoFinance
   bash scripts/deploy/provision-vercel-gcp.sh --check
   bash scripts/deploy/provision-vercel-gcp.sh
   ```

2. **Projeto Vercel** (`ecofinance`, já criado): importado do GitHub com *Root Directory* `apps/next`, framework
   Next.js, previews desligadas e as variáveis acima em Production.
3. **AUTH_SECRET:** gere no Cloud Shell com `openssl rand -hex 32` e cole em
   *Settings → Environment Variables*, tipo **Sensitive**, só Production. Não envie o valor
   por chat nem o grave em arquivo.
4. **Deploy:** cada push na `main` publica em Production. Para publicar após mudar
   variáveis, use *Redeploy* no último deployment.
5. **Primeiro acesso (Cloud Shell):** `bash scripts/deploy/first-user.sh`. Não há cadastro
   público.
6. **Conferência:** `https://<domínio>/api/health` responde `ok`, e o login funciona no
   domínio de produção.

## Limites e custos

- O plano Hobby da Vercel é para uso pessoal e não comercial, com cotas mensais de
  execução e banda. Confira [preços](https://vercel.com/pricing) antes de ampliar o uso.
- O Firestore Enterprise é cobrado pelo Google; o orçamento com alertas está em
  [cloud-run.md](cloud-run.md#orçamento-e-alerta-de-billing) e vale para o projeto todo.
- PDF/OCR roda na função, que também tem limite de memória. O servidor recusa OCR sem
  folga de memória, e `IMPORT_OCR=off` desliga o OCR mantendo PDFs com texto.

## Rollback e corte de emergência

- **Rollback:** no painel, *Deployments → (deployment anterior) → Instant Rollback*.
  Só o código volta; os dados do Firestore não. Veja
  [firebase-migration.md](../refatoracao/firebase-migration.md) antes de reverter mudança
  de formato de dados.
- **Corte imediato do acesso ao banco:** remova o vínculo da federação. As funções
  passam a receber erro de autorização do Google:

  ```bash
  gcloud iam service-accounts remove-iam-policy-binding ecofinance-runtime@ecofinance-912de.iam.gserviceaccount.com \
    --role=roles/iam.workloadIdentityUser \
    --member="principal://iam.googleapis.com/projects/$(gcloud projects describe ecofinance-912de --format='value(projectNumber)')/locations/global/workloadIdentityPools/vercel/subject/owner:ooliveiradevs-projects:project:ecofinance:environment:production"
  ```

  Para reabrir, rode `provision-vercel-gcp.sh` de novo.
- **Rotação do AUTH_SECRET:** troque o valor no painel e faça *Redeploy*. Todas as sessões
  web e tokens do Expo são invalidados.

## App Expo

Use o domínio de produção como `EXPO_PUBLIC_API_URL` ou digite-o na tela de login. O app
autentica por Bearer, sem Origin, e só aceita HTTPS fora do emulador.
