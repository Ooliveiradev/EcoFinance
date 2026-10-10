# Revisão das issues em 09/10/2026

Base: `origin/main` em `7be3512`, incluindo o PR #80. Encerradas: #1–#9, #12, #14, #15, #29, #36, #38 e #47. #18 é agregadora.
Entregas desta rodada: [importação unificada #8](importacoes.md) (PR #53), [métricas #12 parcial](metricas.md) (PR #52), [CORS #38](cors.md) (PR #54), [Expo #13 parcial](mobile.md) (PR #55), [formatos estruturados #9](formatos.md) (PR #56), [dados e backup #14](dados.md) (PR #57), segurança do repositório (PR #60) e [deploy Cloud Run](../deploy/cloud-run.md) (PR #61, infraestrutura GCP ainda não provisionada).

Modelo/tela existente não equivale a um fluxo completo. A revisão abaixo registra
as lacunas que impedem novos fechamentos; não certifica a implantação em produção.

| Issue | Evidência e critério ainda pendente |
| --- | --- |
| #5 | Concluída no PR #49, com CRUD, transferências, exclusão reversível e CI completa |
| #6 | Recorrências versionadas, geração/pagamento/adiar/pausar, orçamento/cópia revisada, conciliação e meses fechados entregues no PR #50; evidências em planejamento.md e no PR |
| #7 | Cadastro de cartões, faturas/parcelas confirmadas, pagamento separado do gasto, estornos/encargos/créditos/saldo anterior, divergência e conciliação auditável implementados; entregues no PR #51 com CI completa aprovada |
| #8 | Concluída no PR #53: upload múltiplo, detecção extensível, staging/revisão/prévia, confirmação atômica/idempotente, duplicidades e desfazer protegido; evidência em importacoes.md |
| #9 | Concluída no PR #56: OFX/QFX SGML/XML, CSV/TSV com encodings e datas ambíguas, XLS/XLSX com aba e célula de origem, mapeamento assistido e corpus sintético; evidência em formatos.md |
| #10 | PDF digital/escaneado e fotos com OCR local, evidência por página e região, senha transitória, progresso, cancelamento e limites de memória/tempo; evidência em documentos.md (PR deste incremento) |
| #11 | Chat externo desativado; faltam adapters e assistência opt-in/local |
| #12 | Concluída nos PRs #52 e #80, com serviço único e jornada de revisão/correção/confirmação/desfazer validada em dashboard, gráficos, tabelas, API e CSV em competência/caixa; CI completa aprovada |
| #13 | PR #55 entrega telas nativas, cache/rascunhos por usuário, replay idempotente e conflitos; este incremento acrescenta correção de campos e linhas inválidas na importação, salvamento explícito e bloqueio de confirmação com rascunhos pendentes (mobile.md). Validação iOS e jornadas restantes pendentes |
| #14 | Concluída no PR #57: CSV seguro, backup versionado do usuário, restauração com prévia/atomicidade, exclusão confirmada; evidência em dados.md |
| #15 | Concluída no PR #74: Pluggy, Uber, mapa/GPS, captura antiga e ingestão global removidos; dados históricos preservados e cobertos por consulta, CSV, backup e restauração |
| #16 | Gates e jornadas básicas existem; release/jornadas completas/mobile ainda pendentes |
| #17 | README atualizado; faltam capturas reais dos fluxos finais entregues |
| #18 | #1–#9, #12, #14, #15 e #38 completas; #13 parcial; demais critérios permanecem nas respectivas issues |
| #19 | Captura automática desativada; faltam opt-in, staging, provas nativas e conector de email |
| #28 | URLs/cookies seguros e exceções locais definidas; falta comprovar transporte/redirects da implantação |
| #30 | MFA não implementado |
| #31 | Login tem rate limit; falta cobertura operacional de todas as superfícies/rajadas/recuperação |
| #32 | Schemas/limites existentes; cobertura completa das fronteiras precisa ser demonstrada |
| #33 | React codifica saídas; falta auditoria/testes contextualizados de todas as fontes |
| #34 | Consultas parametrizadas existem; falta matriz explícita de entradas hostis e inventário de SQL indireto |
| #35 | Migrations/backup existentes; falta runbook de rollback de código/configuração/dados e ensaio completo |
| #37 | Segredos server-only e scanners existentes; faltam rotação/revogação e evidência operacional |
| #38 | Concluída no PR #54: allowlist CORS exata (somente AUTH_URL), preflight e origem negada antes da autenticação, inventário em cors.md |
| #39 | Logs de auth desativados para evitar vazamentos; trilha de eventos/retencão/correlação não entregue |
| #40 | SecureStore e hashes não comprovam criptografia de volumes, arquivos e backups |
| #41 | Lockfile, patches, auditoria, Dependabot e Actions fixas existem; política de prazos/exceções e inventário formal incompletos |
| #42 | Significado de PMP ainda depende da confirmação registrada no ticket |
| #43 | Health endpoint não comprova métricas, alertas e simulações de incidentes |
| #44 | Restauração sintética existe; RPO/RTO, responsáveis e runbook de incidente completos ainda pendentes |
| #47 | Concluída no PR #48, com Firestore Enterprise em São Paulo, runtime/autenticação, regras, backup/reversão e CI incluindo Android nativo |

As issues só são encerradas após a CI completa do PR correspondente. O site ainda não está publicado: o workflow de deploy falha de propósito até o GCP ser provisionado conforme `docs/deploy/cloud-run.md`.
