# Transição: retirada de Open Finance e fluxos legados (#15)

O fluxo principal do EcoFinance é cadastro manual, importação de arquivos com
revisão e planejamento mensal. Pluggy, captura por notificação/GPS, mapa,
webhook Uber e a ingestão global gravavam lançamentos sem revisão, dependiam de
credenciais externas ou de uma chave compartilhada. Esta etapa remove esse
código. Os dados que ele gravou continuam no banco e saem no backup e na
exportação.

## Substitutos já disponíveis

| Fluxo legado | Substituto | Documento |
| --- | --- | --- |
| Pluggy (sincronização bancária paga) | Importação OFX/QFX/CSV/TSV/XLS(X) em staging, com revisão e confirmação | [importacoes.md](importacoes.md), [formatos.md](formatos.md) |
| Notificação bancária + GPS (Android) | Cadastro manual web/Expo e importação; captura opt-in futura na #19 | [cadastro-manual.md](cadastro-manual.md), [mobile.md](mobile.md) |
| Webhook Uber (Apps Script + Gemini) | Lançamento manual ou importação do extrato/fatura | [cadastro-manual.md](cadastro-manual.md) |
| `/api/transactions/import-ofx` (ingestão direta) | `POST /api/imports` (mesmo contrato de staging; a rota antiga já era só um alias) | [importacoes.md](importacoes.md) |
| `/api/seed` (dados de demonstração) | Provisionamento pelo operador e fixtures sintéticas dos testes | [autenticacao.md](autenticacao.md) |
| `/api/session` (sessão global por chave) | Better Auth com sessão por dispositivo (`/api/auth/*`, `/api/sessions`) | [autenticacao.md](autenticacao.md) |
| Mapa de gastos (`/map`, PostGIS/Leaflet) | Nenhum. A tela usava dados fictícios e não existia na navegação | — |
| Backup informal | Backup versionado, restauração e CSV de lançamentos (#14) | [dados.md](dados.md) |

## Inventário do que saiu

| Item | Onde estava | Por quê |
| --- | --- | --- |
| Rotas `api/pluggy/{token,sync,webhook}` | `apps/next/src/app/api/pluggy` | Open Finance pago deixou de ser requisito; as rotas só respondiam 410 |
| Rotas `api/transactions/{notification,uber-webhook,nearby,import-ofx}` | `apps/next/src/app/api/transactions` | Ingestão sem revisão, consulta espacial e alias de importação; as três primeiras respondiam 410 |
| Rotas `api/seed` e `api/session` | `apps/next/src/app/api/{seed,session}` | Seed de demonstração e sessão global por chave, já desativados (410) |
| `retiredEndpoint` | `apps/next/src/lib/session.ts` | Sem rotas retiradas para servir |
| Cliente Pluggy | `apps/next/src/lib/pluggy-client.ts` | Não era importado por nenhum módulo |
| SDK `react-pluggy-connect` | `apps/next/package.json` | Não era importado |
| Página `/map` | `apps/next/src/app/map` | Mapa com dados fictícios, fora da navegação |
| Permissões de notificação e localização nas Configurações | `apps/next/src/app/settings/settings-client.tsx` | Pediam permissões do navegador que nenhum fluxo usa |
| Tarefa de notificação do Expo (`disableLegacyCapture`) | `apps/expo/src/services/notification-handler.ts` | Ver "Expo" abaixo |
| `expo-notifications`, `expo-task-manager`, plugin `expo-notifications` e metadados de cor de notificação | `apps/expo/package.json`, `app.json`, `AndroidManifest.xml`, `colors.xml` | Só existiam para a captura; saem também `RECEIVE_BOOT_COMPLETED`/`POST_NOTIFICATIONS` que a biblioteca mesclava no manifesto |
| Apps Script de recibos Uber | `gas/uber-parser.js` | Lia o Gmail, enviava o HTML ao Gemini e postava no webhook com a chave global |
| Validadores e tipos da ingestão global (`createTransactionSchema`, notificação, Pluggy, Uber, nearby, `importOfxSchema`, payloads e tipos Pluggy) | `packages/shared/src/{validators,types}.ts` | Contratos das rotas removidas; nada mais os importava |
| Utilitários da captura (`generateDeduplicationHash`, `isWithinTimeWindow`, `parseAmountFromText`, `categorizeTransaction`) | `packages/shared/src/utils.ts` | Deduplicação e classificação por texto de notificação, sem uso |
| Variáveis `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `API_SECRET_KEY`, `EXPO_PUBLIC_API_SECRET`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*` | `turbo.json` | Nenhum código as lê |
| Passo `curl -X POST /api/seed` | `CONTRIBUTING.md` | Rota removida |

Já tinham saído antes desta etapa: telas `home`/`accounts`/`ai` do Expo,
`location-service`, o plugin de notification listener, `expo-location`,
`react-native-pluggy-connect`, `react-native-webview` e `expo-intent-launcher`
(#13), a chave global `API_SECRET_KEY` como credencial (#3) e as permissões de
localização do Android, bloqueadas em `android.blockedPermissions` (#13; o
bloqueio continua).

### Rotas: 404, não 410

As rotas retiradas foram apagadas e passam a responder 404. A resposta 410
temporária foi descartada porque:

- nenhum cliente atual chama essas rotas. A web nunca chamou; o Expo deixou de
  chamar na #13, e os e2e só verificavam a própria desativação;
- o deploy Cloud Run ainda não foi ativado, então nenhuma instalação publicada
  da nova base serviu essas rotas a clientes antigos;
- um handler 410 ainda consultava a sessão no banco a cada chamada e mantinha
  código e superfície de ataque sem função;
- o comportamento continua fechado. Sem sessão, o `proxy.ts` responde 401 antes
  do roteamento, inclusive para a antiga `x-api-secret-key`. Com sessão, o Next
  responde 404 porque não existe handler. Nenhum caminho lê o corpo ou grava
  dados.

Instalações antigas que ainda tenham o webhook configurado na Pluggy ou o
gatilho do Apps Script ativo devem removê-los no painel da Pluggy e em
script.google.com. As chamadas falham (401 ou 404) e não gravam nada.

### Expo

A tarefa `ECOFINANCE_NOTIFICATION_HANDLER` e as bibliotecas nativas que a
executavam saíram juntas. Uma instalação antiga atualizada para este APK não
tem mais o módulo nativo capaz de acordar o JavaScript em segundo plano. O
registro que ficar salvo pelo `expo-task-manager` antigo fica inerte, sem
código, permissão ou serviço que o dispare. O app não declara permissão de
notificação, localização ou leitura de notificações. A tela de onboarding e a
de Configurações informam isso ao usuário.

### Proteção contra reintrodução

`scripts/security/policy.mjs` mantém `retiredCredentials` (`PLUGGY_CLIENT_ID`,
`PLUGGY_CLIENT_SECRET`, `API_SECRET_KEY`, `EXPO_PUBLIC_API_SECRET`). Ler
qualquer uma delas em `apps/` ou `packages/`, inclusive no servidor, reprova
`pnpm security:source`. Variáveis `EXPO_PUBLIC_*`/`NEXT_PUBLIC_*` com nome de
segredo continuam bloqueadas pela regra geral.

## Dados históricos: o que permanece e onde

Nada foi apagado do banco. O runtime usa Firestore. PostgreSQL/PostGIS ficou
como ferramenta de exportação, reversão e ensaio de migração
([firebase-migration.md](firebase-migration.md)).

| Dado | Onde está | Leitura | Exportação/backup |
| --- | --- | --- | --- |
| `source` = `pluggy`, `notification`, `uber` | Campo `source` de `transactions` (Firestore); enum `transaction_source` (PostgreSQL) | Lista de lançamentos, Meu mês, relatórios e conciliação de recorrências tratam essas origens como lançamentos comuns; o painel mostra o rótulo de origem | Coluna `origem` do CSV (`/api/data/entries`) e backup completo (`/api/data/backup`) |
| Coordenadas (`latitude`, `longitude`) | `transactions` (Firestore). No PostgreSQL, `geom geography(POINT,4326)` é derivada por trigger | Não exibidas; nenhum fluxo novo grava coordenadas (`null`) | Backup completo. Ao voltar ao PostgreSQL, a coluna `geom` é recalculada a partir das coordenadas (`portable-restore.ts`) |
| Metadados de viagem Uber | Coleção `uberTripsMetadata` e `transactions.uberMetadataId` | Mantidos para os vínculos dos lançamentos antigos | Backup completo ("Metadados legados de viagens"); a restauração por adoção refaz o vínculo com a nova identidade |
| Identificadores Pluggy (`pluggyItemId`, `pluggyAccountId`) | `accounts` | Não exibidos | Backup completo |
| Extensão PostGIS, colunas e índices legados | Migrations `0001`–`0003`, `firestore-catalog.json`, `firestore.indexes.json` | — | Continuam até uma migration futura explicitamente verificada |

`packages/db/tests/legacy-retention.firebase.test.ts` comprova essa retenção.
Lançamentos com as três origens legadas, coordenadas, vínculo Uber e IDs
Pluggy aparecem na listagem e no CSV com a origem correta, saem no backup com
todos os campos e voltam iguais ao restaurar em outra instalação (adoção), com
o vínculo da viagem refeito.

### Retenção

- Lançamentos e metadados legados seguem a mesma regra dos demais dados do
  usuário. Permanecem até o próprio usuário excluir dados ou conta em
  Configurações → Seus dados ([dados.md](dados.md)). Arquivar continua sendo o
  padrão para lançamentos.
- Remover `uberTripsMetadata`, coordenadas, IDs Pluggy, valores do enum
  `source` ou a extensão PostGIS exige uma migration posterior. Antes dela é
  preciso fazer o snapshot, restaurar em banco isolado, conferir contagens,
  somas e origens por conta e garantir a exportação prévia
  ([plano.md](plano.md), "Migração e operação"). Até lá, os valores legados
  continuam aceitos pela validação para que backups antigos restaurem.

### Recuperação

1. Exportar: Configurações → Seus dados → backup completo ou CSV de lançamentos.
2. Restaurar: mesma tela. A prévia mostra contagens e totais antes da
   substituição atômica.
3. Banco PostgreSQL legado: `pnpm db:snapshot` e o runbook de
   [firebase-migration.md](firebase-migration.md) levam os dados, com PostGIS e
   metadados Uber, ao Firestore e de volta.

## Captura automática futura

A captura opt-in por notificações Android e e-mail continua planejada na
[#19](https://github.com/Ooliveiradev/EcoFinance/issues/19) (etapas 15 e 17 de
[plano.md](plano.md)). Ela será reconstruída do zero. Eventos entram no staging
da importação para revisão, nunca como despesas diretas. A coleta é por fonte e
com consentimento, e os parsers são versionados. Nenhum código removido aqui
deve ser restaurado para isso: ele gravava sem revisão, usava chave global e
pedia GPS.

## O que ainda aparece numa busca por integrações antigas

Uma busca por `pluggy|uber|notification|latitude|postgis|gps` ainda encontra
estes itens, todos intencionais:

- **Histórico de dados:** enum de origem (`finance.ts`, `firestore-validation.ts`,
  `schema.ts`), rótulos de origem no painel, origens aceitas na conciliação de
  recorrências (`planning-occurrences.ts`), coleção/rótulo do backup
  (`data-export.ts`), campos `latitude`/`longitude`/`uberMetadataId` gravados
  como `null` pelos fluxos novos.
- **Migração/reversão:** migrations SQL, drafts, catálogo e índices Firestore,
  fixtures e testes de recuperação, `docker-compose.yml` e o serviço PostGIS do CI.
- **Proteção:** `retiredCredentials` e testes de segurança; e2e e testes que
  verificam que as rotas antigas não existem e que a chave global é recusada.
- **Documentação:** este arquivo, `plano.md`, `mobile.md`, `cors.md`,
  `autenticacao.md` e o `CHANGELOG.md` da versão 1.0.0.
- **Falsos positivos:** `notification` na cor do tema do React Navigation
  (`App.tsx`) e em `toolExecutionNotifications` da leitura de SARIF.
