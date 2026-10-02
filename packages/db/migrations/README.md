# Migrações versionadas

Execute `pnpm db:migrate` na raiz. O comando lê `DATABASE_URL` do ambiente ou do `.env` do workspace/raiz, sem sobrescrever variáveis existentes.

Arquivos executáveis seguem `NNNN_nome.sql`, em ordem numérica. O runner mantém `public.ecofinance_migrations`, confere SHA-256 (normalizando CRLF), serializa concorrência com advisory lock e aplica todas as pendências em uma transação. Mudança em migration aplicada, versão duplicada ou histórico fora de ordem bloqueiam o avanço. Não editar migration já aplicada.

`0001_init.sql` é o bootstrap do legado: cria o schema de extensões, instala PostGIS, adota tabelas do antigo db:push, valida as colunas monetárias/data, acrescenta geom e recupera índices/funções/trigger. Preserva colunas financeiras e faz backfill apenas da geometria. Não cria unicidade global de external_id: essa falha é reproduzida no teste OFX e a correção precisa do novo escopo de proprietário/conta/fonte da #2.

`0002_owned_finance.sql` expande o modelo para ownership, categorias editáveis, planejamento, cartões e importações. Legado exige proprietário/nome/fuso explícitos; duplicidades e diferenças financeiras bloqueiam a operação. Consulte [procedimento e evidências](../../../docs/refatoracao/modelo-financeiro.md). Preserva os campos antigos; não adapta automaticamente as rotas à autenticação.

Antes de usar em dados reais, fazer snapshot e ensaio de restauração em banco isolado. Bootstrap, backfill, constraints e pg_dump/pg_restore foram executados localmente em PostgreSQL 16 + PostGIS com dados sintéticos. Nenhum banco de produção foi migrado.

## Próximas alterações

1. `pnpm db:generate` escreve em `packages/db/migration-drafts/`, separado do runner. O baseline de geração representa o schema após EF-02 e serve de base para diffs futuros. Não aplicar esse CREATE completo em um banco migrado. Conservar os snapshots de geração com a mudança seguinte para que futuros diffs tenham uma base conhecida.
2. Revisar o SQL gerado, acrescentar backfill/validações e copiar apenas o SQL aprovado para `migrations/` com o próximo número livre. Não copiar o journal do Drizzle para o runner.
3. Criar fixture anterior à mudança e testes de preservação dos dados/constraints. DDL precisa ser transacional; comandos como CREATE INDEX CONCURRENTLY requerem procedimento operacional separado.
4. Executar integração e restauração antes de aplicar em produção. Não usar db:push como migração de release.

`pnpm test:integration` exige `TEST_DATABASE_URL` de um servidor de testes com PostGIS e permissão para criar/remover bancos. A suíte cria somente bancos `ecofinance_test_<id aleatório>` e remove esses bancos ao terminar; não aplica migrations no banco indicado pela URL.
