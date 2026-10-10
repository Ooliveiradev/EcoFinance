# EcoFinance

Gerenciador financeiro pessoal em evolução, com web Next.js, Expo e Cloud Firestore. O [plano de refatoração](docs/refatoracao/plano.md) acompanha os critérios de cada entrega.

A [migração para Firebase (#47)](docs/refatoracao/firebase-migration.md) usa Firestore Enterprise no projeto `ecofinance-912de`, banco `ecofinance`, em São Paulo. O runtime web e a autenticação persistem no Firebase; PostgreSQL permanece como ferramenta de exportação/reversão.

## Estado da implementação

- Modelo financeiro por proprietário, dinheiro exato, datas civis e migration aditiva com backfill auditado.

- Autenticação local por email/senha, sessões revogáveis por dispositivo e isolamento de dashboard/contas/lançamentos.

- Login web com cookie protegido; Expo com sessão no SecureStore; recuperação de acesso pelo operador sem serviço pago obrigatório.

- CI com tipos, lint, domínio, migrações/backup, E2E, builds, bundles e verificações de segurança.

O [cadastro manual web (#5)](docs/refatoracao/cadastro-manual.md) permite manter contas, categorias, receitas, despesas e transferências, com exclusão reversível e saldos derivados de movimentos liquidados. Contas legadas sem data de saldo inicial exibem saldo incompleto. O [planejamento mensal web (#6)](docs/refatoracao/planejamento.md) acrescenta recorrências, pagamento/conciliação, orçamento, revisão de cópia e fechamento de mês. [Cartões e faturas (#7)](docs/refatoracao/cartoes.md) incluem parcelas confirmadas, pagamentos separados do gasto, estornos/encargos/créditos, divergência e vínculos de conciliação. A [importação unificada web (#8)](docs/refatoracao/importacoes.md) recebe múltiplos arquivos em staging, com detecção por conteúdo, revisão e prévia, confirmação atômica, duplicidades, cancelamento, repetição e desfazer protegido. Os [formatos estruturados (#9)](docs/refatoracao/formatos.md) incluem OFX/QFX/CSV/TSV/XLS/XLSX, mapeamento assistido e evidência por linha/célula. [PDF e fotos (#10)](docs/refatoracao/documentos.md) usam texto do PDF ou OCR local, sem serviço externo, com evidência por página e região, senha de PDF só durante a análise e conferência de totais.

Os [relatórios mensais (#12)](docs/refatoracao/metricas.md) compartilham os cálculos entre dashboard, gráficos, tabelas, API e CSV, nas visões de competência e caixa. Revisar um lote altera somente a prévia; confirmar ou desfazer atualiza os números na próxima leitura. O [Expo (#13)](docs/refatoracao/mobile.md) já possui telas financeiras nativas, cache e rascunhos por usuário; funções restantes e validação em Android/iOS continuam pendentes.

A ingestão imediata antiga (Pluggy, notificações/GPS, Uber, seed, sessão global e a rota OFX direta) e o mapa foram removidos; os lançamentos que ela gravou continuam consultáveis e exportáveis. Inventário, motivos e retenção dos dados: [transição (#15)](docs/refatoracao/transicao.md). O chat externo está desativado até haver opt-in explícito e contratos autorizados. Nenhuma chave de Open Finance, IA externa ou conta paga é necessária para login, migrações e testes.

## Executar a instalação pessoal

Node >=22.13, pnpm 9.15 e acesso ADC ao projeto Firebase (ou Java 21 para o emulador). Consulte [.env.example](.env.example); mantenha os segredos somente no servidor.

```sh
pnpm install --frozen-lockfile
gcloud auth application-default login --project ecofinance-912de
pnpm db:firebase init-empty
pnpm dev
```

Configure AUTH_URL como a URL canônica da instalação e AUTH_SECRET aleatório de pelo menos 32 caracteres. Use HTTPS fora de localhost/emulador. O acesso público não permite cadastro automático. Provisione o primeiro login e eventual proprietário legado pelo [procedimento de autenticação](docs/refatoracao/autenticacao.md). A hospedagem em produção usa Cloud Run em São Paulo, com deploy aprovado pelo mantenedor e sem chave de service account: [runbook](docs/deploy/cloud-run.md).

A base real foi confirmada vazia e inicializada. Antes de qualquer importação futura, ensaie backup, restauração e reversão conforme o [runbook Firebase](docs/refatoracao/firebase-migration.md). O [modelo SQL histórico](docs/refatoracao/modelo-financeiro.md) permanece congelado para recuperação.

No Expo, informe servidor/email/senha no login. A URL do servidor pode vir de EXPO_PUBLIC_API_URL; essa variável não contém senha nem token. Captura automática está desativada nesta transição. Bundles JS não comprovam execução nativa ou testes em aparelhos.

## Validação

```sh
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm security:selftest
pnpm security:source
pnpm security:audit
pnpm mobile:check
```

As fixtures são sintéticas. Java 21 e o emulador Firestore são necessários:

```sh
npx firebase-tools@15.32.1 emulators:exec --only firestore --project demo-ecofinance "pnpm test:firebase && pnpm test:e2e"
```

Execute o build web antes do E2E. PostgreSQL/PostGIS descartável com TEST_DATABASE_URL é usado somente por pnpm test:integration e pelo ensaio pnpm test:rollback executado dentro do emulador. Os testes recusam destinos de produção.

[CI e gates](docs/ci-quality.md), [baseline](docs/refatoracao/baseline.md), [autenticação/recuperação](docs/refatoracao/autenticacao.md).

## Organização

| Pasta | Responsabilidade |
| --- | --- |
| apps/next | Web, API, autorização e serviços de aplicação |
| apps/expo | Interface nativa e sessão segura |
| packages/shared | Contratos, dinheiro/calendário e regras puras |
| packages/db | Persistência Firestore, validações e ferramentas de exportação/recuperação |

Issues concluídas são vinculadas no PR com Closes #N. Uma entrega parcial mantém a issue aberta. O checklist e a evidência, incluindo limites de validação, determinam o encerramento.

MIT. Nenhuma promessa de compatibilidade universal de arquivos ou captura automática antes dos respectivos testes.
