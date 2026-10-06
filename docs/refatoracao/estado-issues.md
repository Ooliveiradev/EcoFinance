# Revisão das issues em 06/10/2026

Base: `origin/main` em `83df5f3`, PR #46 integrado. GitHub consultado nesta data:
nenhum PR aberto; #1, #2, #3, #4, #29 e #36 já encerradas. #18 é agregadora.
A prioridade indicada pelo mantenedor é #47 antes da retomada das demais issues.

Modelo/tela existente não equivale a um fluxo completo. A revisão abaixo registra
as lacunas que impedem novos fechamentos; não certifica a implantação em produção.

| Issue | Evidência e critério ainda pendente |
| --- | --- |
| #5 | Contas/lançamentos têm APIs GET; faltam cadastro/edição/exclusão, categorias e idempotência |
| #6 | Tabelas e leitura de planejamento existem; faltam CRUD, geração/pagamento e fluxo de orçamento |
| #7 | Modelo de cartão/fatura/parcela existe; faltam operações e conciliação completas |
| #8 | Modelo de lote/item existe; falta upload/revisão/confirmar/reverter; ingestão antiga desativada |
| #9 | Parser OFX e testes existem; faltam corpus/diagnóstico e suporte completo CSV/TSV/XLS/XLSX/QFX |
| #10 | Não há pipeline PDF/OCR com evidência por item |
| #11 | Chat externo desativado; faltam adapters e assistência opt-in/local |
| #12 | Dashboard mensal existe; métricas ainda usam sinal e snapshots legados, sem serviço financeiro final |
| #13 | Expo possui login seguro; telas financeiras demonstrativas não comprovam paridade |
| #14 | CI ensaia dump/restore operacional; exportação/restore do produto e controle dos dados incompletos |
| #15 | Ingestão antiga desativada; SDKs/código/permissões legados e substitutos ainda pendentes |
| #16 | Gates e jornadas básicas existem; release/jornadas completas/mobile ainda pendentes |
| #17 | README atualizado; faltam capturas reais dos fluxos finais entregues |
| #18 | #1–#4 completas; restante do escopo permanece aberto |
| #19 | Captura automática desativada; faltam opt-in, staging, provas nativas e conector de email |
| #28 | URLs/cookies seguros e exceções locais definidas; falta comprovar transporte/redirects da implantação |
| #30 | MFA não implementado |
| #31 | Login tem rate limit; falta cobertura operacional de todas as superfícies/rajadas/recuperação |
| #32 | Schemas/limites existentes; cobertura completa das fronteiras precisa ser demonstrada |
| #33 | React codifica saídas; falta auditoria/testes contextualizados de todas as fontes |
| #34 | Consultas parametrizadas existem; falta matriz explícita de entradas hostis e inventário de SQL indireto |
| #35 | Migrations/backup existentes; falta runbook de rollback de código/configuração/dados e ensaio completo |
| #37 | Segredos server-only e scanners existentes; faltam rotação/revogação e evidência operacional |
| #38 | Política de origem/CSRF existe; falta inventário/preflight/CORS e prova de origens negadas |
| #39 | Logs de auth desativados para evitar vazamentos; trilha de eventos/retencão/correlação não entregue |
| #40 | SecureStore e hashes não comprovam criptografia de volumes, arquivos e backups |
| #41 | Lockfile, patches, auditoria, Dependabot e Actions fixas existem; política de prazos/exceções e inventário formal incompletos |
| #42 | Significado de PMP ainda depende da confirmação registrada no ticket |
| #43 | Health endpoint não comprova métricas, alertas e simulações de incidentes |
| #44 | Restauração sintética existe; RPO/RTO, responsáveis e runbook de incidente completos ainda pendentes |
| #47 | Inventário/exportação em preparação; acesso/edição Firebase, persistência, importer e recuperação ainda pendentes |

CI da main: [run aprovado](https://github.com/Ooliveiradev/EcoFinance/actions/runs/37328249239)
e [run posterior com falha](https://github.com/Ooliveiradev/EcoFinance/actions/runs/37349559532)
no mesmo SHA. No segundo, tipos/lint, unitários, PostgreSQL/recuperação, web/E2E,
dependências, segredos, CodeQL, React Doctor e workflows passaram; empacotamento
Android `:app:packageDebug` falhou. O log disponível não aponta a causa raiz;
exige diagnóstico/reexecução, sem declarar build Android atual aprovado.

Nenhuma das 31 issues abertas teve todos os seus critérios comprovados nesta
revisão. Assim, não houve novo encerramento por conveniência. #18 deve refletir
#4 concluída pelo PR #46. Novas entregas devem vincular apenas issues integralmente
atendidas com `Closes #N`; #47 permanece aberta durante sua preparação.
