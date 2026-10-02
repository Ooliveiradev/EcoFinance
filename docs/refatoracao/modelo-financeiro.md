# EF-02 — Modelo financeiro e migração do legado

Implementação em 02/10/2026. O schema contém 17 entidades: usuário pessoal, contas, categorias, lançamentos, metadados Uber, regras/ocorrências recorrentes, orçamentos/alocações por categoria, cartões, faturas, grupos/parcelas, lotes/itens de importação, preferências e auditoria da migração.

## Contratos e invariantes

- `owner_id` obrigatório em cada entidade financeira, com FK restritiva para usuário. Referências entre recursos usam `(owner_id, id)`; conta, categoria, fatura, parcela, ocorrência e lote de outro proprietário são rejeitados pelo PostgreSQL. Isso garante integridade referencial; sessão e autorização de leitura/escrita pertencem à EF-03.
- Dinheiro usa `numeric(15,2)` no banco e strings decimais nos novos contratos Zod. Operações exatas usam centavos `bigint`, com validação de faixa e sem arredondamento implícito. BRL é a moeda inicial. Timestamps de auditoria usam `timestamptz`; compra, competência, vencimento, pagamento e início de saldo usam `date`. Competência exige dia 1.
- Tipos explícitos de lançamento: receita, despesa, transferência, estorno e ajuste. Despesa é negativa; receita/estorno são positivos. Liquidado exige data de pagamento. Legado sem tipo é `unclassified` com `review_required=true`; não se infere significado pelo sinal.
- Identidade externa: proprietário + conta + fonte + ID. IDs ausentes não são deduplicados. Ocorrências: proprietário + regra + competência. Lotes: proprietário + chave idempotente; linhas: proprietário + lote + posição. Parcela: proprietário + grupo + número. A execução dos workflows de planejamento/importação será implementada nas respectivas issues.
- Índices de lançamentos cobrem proprietário/data, proprietário/competência, proprietário/conta/competência e proprietário/categoria/competência. Arquivamento conserva os recursos e o histórico; FKs restritivas impedem exclusão destrutiva de recursos referenciados.

Os contratos antigos permanecem para a transição da interface. A nova estrutura rejeita gravações sem proprietário/categoria/datas explícitas. O default de proprietário só lê um contexto definido na transação; ele não atribui automaticamente dados ao primeiro usuário. As rotas antigas deverão ser adaptadas à sessão na EF-03 e aos contratos financeiros na EF-05/EF-08 antes de operar sobre o novo modelo. Não aplicar esta migração ao banco de produção antes dessa adaptação e do ensaio com uma cópia dos dados reais.

## Expansão e backfill

`0001_init.sql` adota o legado e instala PostGIS. `0002_owned_finance.sql` trava as tabelas durante expansão e validação, cria as novas entidades e preserva os campos antigos. Nenhum lançamento/conta é eliminado ou recebe novo ID.

Para uma base com dados, fornecer as três opções juntas, usando um UUID escolhido para o proprietário real:

```powershell
pnpm --filter @ecofinance/db db:migrate --legacy-owner UUID_DO_PROPRIETARIO --legacy-owner-name "Nome do proprietário" --legacy-timezone America/Sao_Paulo
```

O operador precisa confirmar a titularidade da base inteira antes de indicar o proprietário. Legados com múltiplos titulares exigem um procedimento de associação por registro antes de usar este backfill; ele não tenta adivinhar essa distribuição. Banco vazio não cria usuário implicitamente. Fuso inválido, proprietário ausente e identidades externas duplicadas bloqueiam a migração sem commit. Duplicados exigem revisão operacional, preservando a evidência original.

Cada enum legado cria uma categoria editável do proprietário; o vínculo usa `legacy_key`, conservado para auditoria. A data civil deriva do timestamp original no fuso indicado; a competência inicial é o mês dessa data, marcada para revisão. Timestamp, valor, sinal, origem, ID externo, descrição e timestamps de auditoria são conservados. O saldo antigo continua em `balance` como snapshot histórico; não vira saldo inicial ou receita. `opening_balance=0` e `opening_date=NULL` exigem revisão posterior.

São comparados contagens, somas gerais e por conta/fonte, saldo das contas e metadados. `EXCEPT ALL` nas duas direções também confere cada campo original, detectando alterações que se compensariam no total. Qualquer diferença provoca rollback. `financial_migration_audits` guarda proprietário, fuso e relatórios antes/depois. Apenas depois das novas colunas preenchidas são ativadas as constraints e substituídas as FKs destrutivas antigas.

Não remover os enums, `date`, `balance` ou outros campos antigos nesta entrega. Uma migração posterior de contração precisa comprovar adaptação de todos os leitores/escritores, classificação e revisão dos dados, backup restaurável e conciliação. Migrações já registradas não devem ser editadas; o runner verifica SHA-256 normalizado.

## Recuperação e evidências executadas

Antes de qualquer banco real: gerar backup, restaurar em outro banco, comparar dados, migrar a cópia com associação explícita, conferir auditoria e exercício do aplicativo adaptado. Guardar backup fora da instância original. O ensaio sintético valida o procedimento, mas não substitui a verificação do backup real.

O script `packages/db/scripts/verify-recovery.ts` cria quatro bancos descartáveis, faz `pg_dump/pg_restore` do legado antes da migração e do grafo financeiro completo, compara todos os registros em JSON textual e verifica constraints/geografia restauradas. Usa `TEST_DATABASE_URL` de servidor de testes, sem alterar o banco apontado pela URL; exige `pg_dump`/`pg_restore` no PATH ou `PG_BIN`.

```powershell
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/postgres'
$env:PG_BIN=(Resolve-Path .local-postgres/pgsql/bin).Path
node node_modules/tsx/dist/cli.mjs packages/db/scripts/verify-recovery.ts
pnpm test:integration
```

Validação local em PostgreSQL 16.15 + PostGIS 3.6, portátil e isolado em localhost: 14 cenários de integração e 3 testes do runner aprovados; recuperação completa aprovada. Foram exercitados proprietário/fuso ausentes, passagem de mês no fuso civil, valor negativo/estorno, duplicado existente, alteração por trigger durante backfill, vínculos cruzados, gravação anônima, arquivamento/exclusão, escopo de identidades, ocorrência mensal/idempotência e faixa/sinal/datas de liquidação. Nenhum banco real foi acessado.

Os testes unitários dos novos contratos passaram. Typecheck passou nas quatro workspaces. Lint dos arquivos desta entrega foi verificado separadamente; a política global estrita da thread de CI ainda detecta 13 `any` no aplicativo legado. CI remota e execução nativa ficam registradas como pendentes, sem serem confundidas com integridade SQL ou export de bundles.
