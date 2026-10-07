# Revisão das issues em 06/10/2026

Base: `origin/main` em `1f12822`, PRs #48/#49/#50 integrados e #47/#5/#6 encerradas.
#1, #2, #3, #4, #29 e #36 já estavam encerradas. #18 é agregadora.
A entrega de #6 está no [PR #50](https://github.com/Ooliveiradev/EcoFinance/pull/50), com CI completa aprovada. Este incremento entrega [cartões e faturas #7](cartoes.md); seu PR registra os gates e o estado da integração.

Modelo/tela existente não equivale a um fluxo completo. A revisão abaixo registra
as lacunas que impedem novos fechamentos; não certifica a implantação em produção.

| Issue | Evidência e critério ainda pendente |
| --- | --- |
| #5 | Concluída no PR #49, com CRUD, transferências, exclusão reversível e CI completa |
| #6 | Recorrências versionadas, geração/pagamento/adiar/pausar, orçamento/cópia revisada, conciliação e meses fechados entregues no PR #50; evidências em planejamento.md e no PR |
| #7 | Cadastro de cartões, faturas/parcelas confirmadas, pagamento separado do gasto, estornos/encargos/créditos/saldo anterior, divergência e conciliação auditável implementados; integração exige a CI completa deste incremento |
| #8 | Modelo de lote/item existe; falta upload/revisão/confirmar/reverter; ingestão antiga desativada |
| #9 | Parser OFX e testes existem; faltam corpus/diagnóstico e suporte completo CSV/TSV/XLS/XLSX/QFX |
| #10 | Não há pipeline PDF/OCR com evidência por item |
| #11 | Chat externo desativado; faltam adapters e assistência opt-in/local |
| #12 | #5 corrige saldo derivado e totais por competência/tipo; projeções, métricas completas e critérios finais da issue permanecem pendentes |
| #13 | Expo possui login seguro; telas financeiras demonstrativas não comprovam paridade |
| #14 | CI ensaia dump/restore operacional; exportação/restore do produto e controle dos dados incompletos |
| #15 | Ingestão antiga desativada; SDKs/código/permissões legados e substitutos ainda pendentes |
| #16 | Gates e jornadas básicas existem; release/jornadas completas/mobile ainda pendentes |
| #17 | README atualizado; faltam capturas reais dos fluxos finais entregues |
| #18 | #1–#6 completas; cartões #7 neste incremento e demais critérios permanecem nas respectivas issues |
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
| #47 | Concluída no PR #48, com Firestore Enterprise em São Paulo, runtime/autenticação, regras, backup/reversão e CI incluindo Android nativo |

A [CI do PR #48](https://github.com/Ooliveiradev/EcoFinance/actions/runs/37478780725) passou em todos os grupos. A auditoria preservou abertas as issues com lacunas reais; #47 foi encerrada após a integração. A [CI do PR #49](https://github.com/Ooliveiradev/EcoFinance/actions/runs/37547524052) também passou; #5 foi encerrada após a integração. O encerramento de #6 também exige sua própria CI completa. #18 permanece aberta acompanhando as demais entregas. Nenhuma implantação do site em hospedagem externa foi comprovada nesta revisão.
