# Migração para Firebase — issue 47

Atualizado em 06/10/2026. Projeto indicado: `ecofinance-912de`. Esta é a
preparação da migração; o runtime continua usando PostgreSQL. Banco/edição,
acesso ao destino e existência de dados reais no Supabase ainda precisam ser
confirmados. Nenhum recurso Firebase ou dado real foi alterado.

## Inventário da origem

PostgreSQL/PostGIS e Drizzle, migrations 0001–0004. Não há SDK Supabase no
runtime. Better Auth armazena identidade, hashes Argon2, sessões revogáveis e
rate limits no mesmo banco. Retirar PostgreSQL exige adaptar também esse
armazenamento, mesmo que o login não mude para Firebase Authentication.

| Tabelas | Dados e vínculos a preservar |
| --- | --- |
| users | UUID, email normalizado/único, nome e estado de verificação |
| accounts, categories | Dono, saldos de abertura e legados, moeda, arquivamento |
| transactions, uber_trips_metadata | Conta/categoria do mesmo dono, datas distintas, origens/IDs externos e geografia histórica |
| recurrence_rules, recurrence_occurrences | Conta/categoria, calendário e ocorrência única por regra/mês |
| budgets, budget_categories | Mês único por dono e limites por categoria |
| cards, invoices | Conta de pagamento, fechamento/vencimento e fatura única por cartão/mês |
| installment_groups, installments | Total, quantidade, número único de parcela e fatura |
| import_batches, import_items | Idempotência por dono, posição única, estado, proveniência e vínculos |
| preferences, financial_migration_audits | Preferências e evidência histórica de backfill |
| auth_accounts, auth_sessions, auth_verifications, auth_rate_limits | Hashes, credenciais, expiração, recuperação e limites compartilhados |

São **21 tabelas de aplicação**, mais `ecofinance_migrations`. O catálogo
executável em `packages/db/src/portable-snapshot.ts` deriva colunas/FKs do
schema e inclui `transactions.geom`, mantida pelo SQL fora do Drizzle.
Schemas externos como `auth`/`storage` e objetos do provedor exigem inventário
separado; o exportador não afirma cobri-los.

| Consumidor | Adaptação necessária |
| --- | --- |
| lib/dashboard-data.ts | Somas, agrupamento, período anterior, últimas transações, recorrências/faturas e contas |
| lib/owned-queries.ts; GET /api/entries | Dono/conta/data/descrição, ordenação e limite; substring não equivale a consulta Firestore simples |
| GET /api/accounts; páginas accounts/transactions | Leitura restrita ao dono e serialização exata |
| páginas planning/imports | Relações de orçamento, recorrência, cartão/fatura e lote |
| lib/auth.ts, provision-user.ts, api/auth e api/sessions | Adapter mantido, email único, provisionamento atômico, revogação e rate limit |
| Expo | Continua consumindo API; credenciais administrativas nunca vão ao cliente |
| Ingestão/chat/mapa legados | Manter rotas desativadas durante a troca |

## Destino e acesso

A CLI desta sessão não conseguiu ler a configuração pessoal (`EPERM`). Com
configuração temporária, informou ausência de autenticação. Após login:

```sh
npx firebase-tools@latest login
npx firebase-tools@latest firestore:databases:list --project ecofinance-912de
npx firebase-tools@latest firestore:databases:get <database-id> --project ecofinance-912de
```

Registrar banco, edição, região e identidade do runtime antes de adicionar
dependências ou modelagem específicas. Avaliar Firestore e SQL Connect
(anteriormente Data Connect) conforme o projeto existente: o primeiro exige
substituir joins/FKs/constraints por consultas e transações da aplicação; o
segundo mantém modelo relacional, com serviço SQL gerenciado e contratos próprios.
Custos e compatibilidade precisam ser comprovados antes da decisão.

No Firestore, manter UUIDs originais, dinheiro em string decimal ou centavos
inteiros com limite comprovado, datas civis como strings e timestamps sem truncar
microssegundos. Identidades únicas exigem reservas transacionais: email, origem
externa, ocorrência/mês, fatura e idempotência. Ciclos entre transação, parcela,
fatura e item de importação exigem importação em duas fases e validação global.

Com acesso exclusivamente pela API, negar acesso direto de clientes ao banco.
Admin SDK exige IAM restrito e autorização da API; Security Rules não substituem
esse isolamento. Usar identidade/ADC no servidor quando possível. Escolher um
adapter Better Auth compatível e testar login/revogação/recuperação/concorrência
antes de retirar PostgreSQL. Não trocar hashes de senha por valores reversíveis.

Ensaiar dono/mês/data/ID, dono/conta/mês, dono/categoria/mês, regra/mês,
cartão/mês, lote/posição, sessão/expiração e rate limit. Índices dependem da edição
e das operações. Medir leituras, latência p50/p95, índices, escritas e custo com
carga sintética reproduzível. Medições Firebase ainda estão pendentes.

Referências: [transações Firestore](https://firebase.google.com/docs/firestore/manage-data/transactions),
[limites](https://firebase.google.com/docs/firestore/quotas),
[SQL Connect](https://firebase.google.com/docs/sql-connect).

## Exportação verificável

Usar origem já atualizada pelas migrations 0001–0004. Banco legado deve primeiro
ser restaurado isoladamente e passar pelo backfill com dono/fuso explícitos.
Não migrar o banco real apenas para exportá-lo.

```sh
# DATABASE_URL aponta para a origem/restauração inventariada.
pnpm db:snapshot export .local-migrations/source.json
pnpm db:snapshot verify .local-migrations/source.json
# Após implementar exportação compatível do destino:
pnpm db:snapshot compare .local-migrations/source.json .local-migrations/target.json
```

Uma transação REPEATABLE READ READ ONLY, com timezone UTC, exporta os campos
das 21 tabelas sem modificar a origem. `numeric`, `bigint`, JSONB, datas,
timestamps e geografia viram texto **no PostgreSQL, antes de JSON.parse**.
JSONB é texto JSON, preservando números internos grandes; `geom` é EWKB
hexadecimal. O futuro importer deve respeitar esses codecs.

Cada tabela contém registros, contagem, SHA-256 canônico e somas monetárias em
centavos usando BigInt serializado como string. Verificação recusa campos
ausentes/desconhecidos, IDs repetidos, tipos errados, checksum/soma divergente,
referência ausente e vínculo entre donos. Comparação exige igualdade de todos os
registros e do histórico nome/checksum, não apenas totais; horário de exportação
pode diferir. Isso verifica transporte/vínculos, não todas as regras de domínio.
Hashes detectam alteração, mas não autenticam um artefato contra um invasor que
também possa recalculá-los.

O arquivo contém dados privados, hashes de senha e possíveis tokens. Guardar
localmente em pasta protegida; nunca anexar a PR/issue/CI nem enviar ao Jev.
`.local-migrations/` é ignorada pelo Git. O comando cria um arquivo novo de modo
exclusivo, com modo 0600 onde suportado; no Windows, conferir ACLs da pasta.
Logs não imprimem linhas nem URL da conexão.

Limite atual: 100 mil registros totais e timeout SQL de 60 segundos por consulta.
O artefato fica em memória; bases grandes exigem streaming/limite de bytes antes
do uso operacional. Arquivo parcialmente gravado falha na verificação.
Esse transporte **não é backup completo**, importer Firebase ou restore:
DDL, permissões, extensões e `applied_at` de migrations não são exportados.
Fazer também `pg_dump --format=custom` e ensaiar `pg_restore`.

## Corte e reversão a implementar

1. Confirmar dados reais, acesso à origem, banco e edição de destino.
2. Fazer dump completo, restaurar isoladamente e reconciliar a exportação.
3. Implementar repositórios, adapter de autenticação e importer reexecutável
   em ambiente de ensaio. Repetição deve recusar divergências, nunca sobrescrevê-las.
4. Verificar dois donos/IDs cruzados, valores/datas, sessões, concorrência,
   retries, restauração, custo/latência e gates do projeto.
5. Entrar em manutenção no corte e bloquear todos os escritores, inclusive
   provisionamento/reset, sessões e rate limits. Snapshot não captura escritas
   posteriores; não adotar dual write improvisado. Exportar novamente e comparar.
6. Registrar commit/backup/manifesto e validar o runtime Firebase antes de liberar
   escritas. Nesse ponto, rollback pode usar aplicação/banco antigos congelados.
7. Depois de novas escritas Firebase, rollback exige exportação reversa validada
   ou replay auditável; o snapshot antigo perderia dados. Ensaiar esse caminho
   antes do corte de produção.
8. Remover dependências/serviços antigos somente após reconciliação e recuperação
   comprovadas. Fechar #47 apenas com todos os critérios atendidos.

## Evidência desta preparação

Fixture PostgreSQL sintética com duas pessoas, planejamento, cartão, importação
e geografia: 21 tabelas exportadas e verificadas. Unitários cobrem centavos,
inteiros grandes, JSON, datas, alterações, duplicatas e vínculos cruzados;
integração cobre repetição, campos históricos, schema desconhecido e limite de
registros. Nenhum dado real foi acessado. Runtime Firebase, recuperação, corte
e medição de custo permanecem pendentes.
