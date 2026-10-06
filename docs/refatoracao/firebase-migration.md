# Migração para Firebase — issue 47

Atualizado em 06/10/2026. O mantenedor confirmou que o Supabase está vazio.
Projeto: `ecofinance-912de`; banco **`ecofinance`**, Enterprise Native, região
**São Paulo (`southamerica-east1`)**. API habilitada, banco criado e regras/índices
publicados pelo Firebase CLI. A base real foi inicializada vazia e seu backup
foi verificado. Nenhuma fixture sintética foi inserida no projeto real.

O runtime web usa Firestore para finanças, identidade Better Auth, credenciais,
sessões e limites de login. O Expo conserva seu contrato HTTP e SecureStore.
Firebase Authentication, Storage e Hosting não foram substituídos nesta issue.
A publicação do site em um serviço de hospedagem é separada da configuração do banco.

## Inventário e modelo

Origem histórica: PostgreSQL/PostGIS, Drizzle e migrations 0001–0004.
São 21 tabelas, exportadas pelo catálogo em `portable-snapshot.ts`:

| Grupo | Coleções Firestore correspondentes |
| --- | --- |
| Identidade | users, authAccounts, authSessions, authVerifications, authRateLimits |
| Contas/lançamentos | accounts, categories, transactions, uberTripsMetadata |
| Planejamento | recurrenceRules, recurrenceOccurrences, budgets, budgetCategories |
| Cartões | cards, invoices, installmentGroups, installments |
| Importações | importBatches, importItems |
| Preferências/auditoria | preferences, financialMigrationAudits |

Cada documento usa o UUID existente como ID. Campos são camelCase, preservando
o contrato TypeScript. `_unique` guarda claims transacionais de todos os índices
únicos da origem; `_migration/source` registra schema/hash/histórico importado.
`firestore-catalog.json` congela tipos, referências e unicidades sem carregar SQL
no runtime. Validação de escrita exige valores/tipos corretos, moeda BRL,
datas válidas, sinais/estados, proprietário imutável e referências do mesmo dono.
Exclusão direta de finanças/usuários é recusada; fluxos de arquivamento e CRUD
completo pertencem à #5 e seguintes. Auth só apaga registros descartáveis.

Dinheiro permanece string decimal; somas usam BigInt em centavos no servidor.
O gráfico recebe Number apenas após verificar o limite de representação. Datas
civis permanecem YYYY-MM-DD, competências no primeiro dia. Timestamps são nativos
Firestore e conservam microssegundos no armazenamento, inclusive após ler/editar
campos diferentes. A geografia PostGIS histórica é preservada como campo de
migração; integrações/mapa antigos continuam desativados.

JSON é convertido somente quando todos os números têm representação decimal
exata em JS/Firestore. Inteiros/decimais que perderiam precisão e contadores fora
do intervalo seguro são recusados, sem converter silenciosamente. A origem real
vazia não exige esse caso; uma migração futura com esses campos precisa de codec
específico antes de ser autorizada ao corte.

## Consultas, integridade e autenticação

Leituras usam pipelines Enterprise com ownerId aplicado pelo servidor. O cliente
não fornece o proprietário. IDs/conta/período/substring são filtros validados;
pipelines preservam substring literal sem tratar `%`/`_` como SQL. Os joins buscam
somente IDs referenciados e verificam novamente seu proprietário. Índices densos
por dono/data/mês/nome e chaves de login estão em `firestore.indexes.json`.

Dashboard/planejamento filtram período no banco, com agregação BigInt no servidor
para evitar overflow/arredondamento de dinheiro. Isso é uma escolha de precisão:
a API Number do SDK não conserva qualquer soma int64 acima de 2^53. Nenhuma
agregação financeira é delegada ao navegador. Consultas sem limite explícito
recusam mais de 10.000 documentos, em vez de mostrar totais truncados; a futura
paginação/materialização deve acompanhar crescimento. Listagem de entries tem
limite validado; histórico de imports retorna os dez últimos lotes.

O adaptador Better Auth usa a fábrica oficial, pipelines e transações Firestore,
com email/credenciais/tokens únicos. Hashes Argon2, cookies HttpOnly/Strict/Secure,
Bearer assinado por dispositivo, validade absoluta de seis horas, revogação em
cada pedido, proteção de origem/CSRF e limites de corpo são mantidos. O contador
de login é atômico e compartilhado entre réplicas. Escritas ficam enfileiradas até
o commit; consultar uma coleção depois de alterá-la na mesma transação é recusado
para impedir leitura obsoleta. Reset consulta sessões antes de escrever.

`next.config.ts` externaliza Admin e Firestore juntos: pipelines verificam classes
com instanceof e o bundle parcial criava duas instâncias incompatíveis do SDK.
Os testes contra o build de produção cobrem esse cenário.

## Ambientes e acesso

Configure `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, `AUTH_URL` e `AUTH_SECRET`.
No desenvolvimento local, use o fluxo oficial:

```sh
gcloud auth application-default login --project ecofinance-912de
pnpm db:firebase init-empty
pnpm dev
```

ADC local foi criado pelo login oficial aprovado pelo mantenedor. `.env` contém
apenas o caminho local ADC e a configuração do servidor; arquivos sensíveis ficam
fora do Git. O token do Firebase CLI não foi copiado para outro arquivo.
Na hospedagem, use identidade de serviço/Workload Identity e a permissão
`roles/datastore.user`, vinculada ao banco necessário; não publique ADC de usuário.
A URL AUTH_URL deve ser HTTPS fora de localhost. Não há cadastro público: crie
o primeiro acesso por JSON em stdin conforme `autenticacao.md`.

As regras publicadas são um protótipo que **nega toda leitura/escrita direta** de
clientes, autenticados ou não. O Admin SDK usa IAM e ignora essas regras, portanto
os testes de ownership no servidor são obrigatórios. O emulador verifica seis
pedidos negados, e o deploy compila a sintaxe. Revisar antes de ampliar o público.
Nenhuma chave administrativa vai ao navegador ou Expo.

Para desenvolvimento/testes, defina `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`,
`FIREBASE_PROJECT_ID=demo-ecofinance` e `FIRESTORE_DATABASE_ID=ecofinance`.
Use Java 21 e `firebase-tools@15.32.1`. As fixtures recusam modificar projeto real.

## Migração, backup e corte

1. Coloque a instalação em manutenção e interrompa novas escritas/login. Não faça
   dual-write. Guarde revisão de código, configuração e backup fora do repositório.
2. Origem SQL com dados: `pnpm db:snapshot export .local-migrations/source.json`.
   A exportação é repeatable-read somente leitura, UTC, com limite de 100.000 linhas,
   inventário exato de tabelas/colunas, SHA-256, somas em centavos e FKs/ownership.
   `pnpm db:snapshot verify <arquivo>` não abre conexão.
3. Destino Firestore vazio: `pnpm db:firebase import <source.json>`; origem realmente
   vazia confirmada pelo operador: `pnpm db:firebase init-empty`.
4. O importador pré-valida todo o grafo, tipos, unicidades e tamanho; cria todos os
   documentos/claims/metadados em **uma transação**. Limite: 400 documentos incluindo
   claims, 8 MiB no total e 900 KiB por documento. Acima disso, recusa o corte e exige
   export/import gerenciado ou ferramenta com staging validado. Não divide um grafo
   em commits parciais. É adequado à base atual vazia e ao ensaio sintético.
5. Reexecutar a mesma entrada em destino idêntico não duplica registros. Destino
   preenchido/divergente é recusado. Após commit, todos os documentos são reconciliados.
6. `pnpm db:firebase backup <novo-arquivo.json>` faz leitura consistente transacional
   de todas as coleções e claims, com codecs tipados para timestamps/maps/arrays e
   hash do conjunto completo. `restore <backup.json>` restaura em destino vazio e
   reconcilia. Não sobrescreve destinos diferentes nem arquivos existentes.
7. Teste login/leituras/isolamento na nova revisão antes de reabrir escritas. Este
   banco começou sem usuários; provisione o primeiro acesso pelo operador.

## Reversão e escritas posteriores

Feche acesso/escritas antes de reverter. Um backup antigo da origem não contém os
novos dados. Primeiro faça backup Firestore e gere **o estado atual**:

```sh
pnpm db:firebase export-portable .local-migrations/current.json
```

Prepare PostgreSQL/PostGIS isolado e vazio, aplique as migrations legadas com
`pnpm db:migrate`, então configure DATABASE_URL desse destino e execute:

```sh
pnpm db:snapshot restore .local-migrations/current.json
pnpm db:snapshot export .local-migrations/sql-restored.json
```

O restore usa casts parametrizados de texto (o serializer Date do driver perderia
microssegundos), ordem das FKs e uma transação única. PostGIS recalcula geom a
partir das coordenadas. Revoga sessões restauradas; teste novo login. Compare
contagens, somas, identidades/referências, timestamps e JSON semanticamente antes
de repor a revisão PostgreSQL `83df5f3` e DATABASE_URL. Não reabra acesso se a
reconciliação falhar. Timestamps novos com precisão mais fina que um microssegundo
são recusados no export para SQL. Limites atômicos de backup também se aplicam.

Ensaio automatizado faz SQL → Firestore → novas escritas (login/conta) → SQL,
comparando cada campo, JSON, soma e referência. Inclui `9999999999999.99`, precisão
de seis casas no timestamp, recusa de destino ocupado e revogação de sessões.

## Custo e desempenho

Consultas reais no banco vazio em São Paulo em 06/10/2026: contas por dono/nome
680 ms (primeira chamada incluindo inicialização), mês de lançamentos 155 ms,
email de login 170 ms. São medições pontuais vazias, sem promessa para bases grandes.
O SDK não retornou explainStats nesse ensaio, mesmo com analyze solicitado;
não afirmamos ter comprovado o plano do índice no serviço real.

[Preço oficial Enterprise](https://cloud.google.com/firestore/enterprise/pricing):
leituras cobram bytes processados em blocos de 4 KiB, incluindo índices/documentos;
escritas usam blocos de 1 KiB e entradas de índice. Uma consulta vazia ainda tem
mínimo de uma unidade de leitura. Limite de resultado não limita sozinho todo o
scan. O custo cresce com número/tamanho de lançamentos no mês, sessões e índices.
Não há listener, busca de texto completa, geoespacial nem cache compartilhado de
finanças nesta entrega. Consulte tarifas da região e consumo real antes de ampliar
uso; PITR e backups gerenciados têm cobrança separada e não foram habilitados.

Índices por dono/período evitam scans globais usuais; substring pode examinar os
lançamentos do dono. A consulta do dashboard faz quatro pipelines e busca IDs
relacionados; cada pedido autenticado também consulta sessão/usuário. Backup e
migração têm limites explícitos. Paginação/agregados exatos e alertas operacionais
seguem o crescimento do produto e #12/#43, sem cache que aceite sessão revogada.

## Evidência

- 130 unitários com cobertura, tipos e lint sem avisos.
- 20 integrações Firebase: autenticação/isolamento, migração, replay,
  restore, unicidade concorrente, valores/datas/referências e regras deny-all.
- 78 jornadas Chromium/WebKit/mobile web contra build de produção.
- Ensaio real Firestore → PostgreSQL com novas escritas e comparação completa.
- 41 testes legados PostgreSQL/export/recovery; cobertura de migration aprovada.
- Auditoria sem avisos de dependência não tratados; bundle web sem credenciais.
- [PR #48 integrado](https://github.com/Ooliveiradev/EcoFinance/pull/48), issue #47 encerrada. A [CI completa](https://github.com/Ooliveiradev/EcoFinance/actions/runs/37478780725) passou, incluindo o build Android nativo.

Dependências SQL foram retiradas de apps/next e das dependências de produção de
packages/db. Permanecem como ferramentas de desenvolvimento para exportação e
reversão, sem conexão ou import SQL no runtime.

## Evolução após a migração

A #5 acrescenta revisão de registros, notas, cores/ordem de contas, vínculo de transferência e a coleção `operations` (22 coleções de aplicação). O backup nativo Firebase inclui todos esses campos e recibos idempotentes. A reversão SQL acima se aplica ao schema histórico entregue na #47. Exportar uma base com campos novos ou operações para aquele SQL é recusado explicitamente: não há descarte silencioso de dados. Após utilizar o cadastro manual, recupere com backup/restore nativo e código compatível. Uma futura reversão SQL precisa de um destino e mapeamento versionados que suportem esse schema. Consulte [cadastro manual](cadastro-manual.md).
