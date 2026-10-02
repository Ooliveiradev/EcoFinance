# EcoFinance

Monorepo Next.js + Expo Android/iOS, com PostgreSQL/PostGIS e contratos compartilhados.

## Desenvolvimento

Node 20+, pnpm 9.15.0. Execute `pnpm install --frozen-lockfile`, copie `.env.example` para `.env` e configure DATABASE_URL. Execute `pnpm db:migrate` e `pnpm dev`. Credenciais externas são opcionais para a fundação financeira.

## Validação

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm mobile:check` e `pnpm build`. Export Expo verifica bundles Android/iOS; não equivale à compilação nativa ou teste em aparelho.

`pnpm test:integration` e `pnpm db:verify-recovery` exigem TEST_DATABASE_URL de servidor descartável com PostGIS/permissão para criar bancos; recuperação exige pg_dump/pg_restore no PATH ou PG_BIN. Os comandos criam e removem somente bancos de teste, sem migrar o banco indicado pela URL.

## Estado

O modelo e a migração EF-02 estão implementados. Banco vazio/legado, vínculos por proprietário, conciliação e recuperação foram validados localmente. Interfaces, sessões e importações ainda usam fluxos antigos: a próxima issue é EF-03. Nenhum banco real foi migrado. Antes de produção, adaptar os escritores, implementar sessão/autorização e ensaiar a migração em backup real restaurado.

Consulte [plano](docs/refatoracao/plano.md), [baseline](docs/refatoracao/baseline.md), [modelo e evidências](docs/refatoracao/modelo-financeiro.md) e [procedimento de migração](packages/db/migrations/README.md). Não usar db:push para releases.
