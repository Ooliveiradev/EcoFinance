# Fronteiras de consultas e SQL (#34)

Revisão em 13/10/2026. O runtime financeiro e a autenticação usam Firestore
Enterprise desde #47. `packages/db/src/index.ts` exporta `DocumentStore`, retenção
e tipos; não abre conexão SQL. `postgres` e Drizzle permanecem dependências de
desenvolvimento do pacote db para ferramentas offline e schema histórico.

## Inventário de SQL direto e indireto

| Superfície | Origem de valores/identificadores e controle |
| --- | --- |
| Web/API, SSR e Expo | Firestore via serviços do servidor; schemas de entrada estritos, ownership e ordenações fixas. Nenhum SQL fornecido pelo cliente é executado |
| `firestore.ts` e adapter Better Auth | Valores são argumentos do SDK, não texto de consulta; coleções vêm de catálogo e adapter fixos. `owned()` rejeita filtro de owner/OR fornecido pelo chamador |
| `migrations.ts`, CLI `migrate.ts` | SQL raw é conteúdo dos arquivos versionados no repositório ou comando estático de search_path. Histórico por checksum bloqueia alteração de migrations publicadas. Dados do proprietário legado usam parâmetros em `set_config` |
| `portable-snapshot.ts`, CLI `portable-snapshot.ts` | Transação read-only/MVCC; tabelas/colunas vêm do schema compilado. Identificadores passam pelo helper do postgres-js; limite de linhas é parâmetro inteiro validado. Catálogo diferente bloqueia exportação |
| `portable-restore.ts`, CLI Firebase `rollback-sql` | Snapshot validado antes de abrir transação; nomes/chaves externos não definem SQL. Identificadores vêm do catálogo; valores são parâmetros de texto com casts. Único cast raw é tipo obtido do schema congelado, nunca do snapshot. Destino deve estar vazio; restore atômico; sessões são revogadas |
| `verify-recovery.ts`, fixtures/tests | CLI de operador usa bancos descartáveis, nomes gerados e identificadores escapados; SQL raw lê fixtures versionadas. pg_dump/pg_restore recebem argumentos separados, com segredo no ambiente e sem log dos valores |
| `schema.ts`, `auth-schema.ts`, Drizzle config | Declarações e expressões estáticas do schema; geração/migração só no CLI do operador. Não recebem uploads ou query strings |
| Importação, OCR e assistência local | Staging/revisão/confirmação por proprietário. Descrições são dados; não viram identificadores nem comandos. Modelo só sugere códigos de categorias existentes, sem ferramentas de SQL/escrita; chat está desativado |

SQL raw não recebe dados financeiros concatenados. Strings em migrations e
fixtures são código confiável do repositório, não um formato de upload. Não
oferecer endpoint para executar SQL/migrations ou aceitar caminhos de arquivos SQL
do usuário. Conexões PostgreSQL pertencem ao operador/CI, sem URL pública no app.

## Controles e testes

O lint impede novas importações de `postgres`, `pg` e Drizzle no runtime web e no
domínio compartilhado. A matriz de entradas hostis verifica:

| Entrada | Evidência |
| --- | --- |
| Descrição contendo aspas, `OR 1=1`, comentário e `DROP TABLE` | Integração Firestore salva/busca como texto literal; filtro diferente retorna vazio; outro proprietário não vê a linha |
| Account id, owner, campo de ordenação e paginação forjados | Schemas recusam antes da consulta, inclusive chaves desconhecidas; ordenação não é controlada por texto do cliente |
| Texto hostil em CSV | Integração importa em staging, nega acesso do outro usuário, exige revisão e só confirma o texto; usuários e coleções permanecem intactos |
| Prompt injection e códigos inexistentes do modelo | `assist-ollama.test.ts` descarta códigos/linhas não oferecidos; modelo não recebe nem executa SQL |
| Valores hostis no SQL histórico | Teste PostgreSQL exporta/restaura um nome com aspas, ponto e vírgula e comandos como parâmetro; contas e usuários permanecem íntegros |
| Tabela/coluna hostil em snapshot | Rejeição do catálogo antes de SQL, mesmo com tentativa de reconstruir hashes; não é permitido mudar identificadores via backup |

Execute `pnpm lint`, `pnpm test:integration` com PostgreSQL/PostGIS descartável e
`pnpm test:firebase` no emulador demo. Os testes não usam dados de produção. Os
arquivos de teste documentam os resultados; a CI completa do PR é a evidência de
execução em Linux. Consultas parametrizadas não substituem autorização por owner.

## Condição para reavaliar

SQL injection não se aplica às consultas atuais do SDK Firestore, mas continua
relevante nas ferramentas históricas. Nova conexão SQL, filtro/ordenação dinâmico,
SQL raw, função de IA com ferramentas, plugin de banco ou endpoint de restauração
SQL exige rever este inventário e os testes antes de remover qualquer restrição.
NoSQL injection, validação geral e menor privilégio seguem também #32 e #42.

Referência: [OWASP — SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html).
