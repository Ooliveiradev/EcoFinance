# Revisão das issues em 13/10/2026

Base: `origin/main` em `008a505`, incluindo os PRs #83 e #85. Conferência direta no GitHub: 19 issues encerradas (#1–#10, #12, #14, #15, #29, #34, #36, #38, #41 e #47) e 18 abertas. #34/#41 foram encerradas após a CI completa e o merge do PR #85. #18 é agregadora; seu checklist foi atualizado com #8, #9, #10, #12, #14 e #15 concluídas.
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
| #10 | Concluída no PR #82 integrado: PDF digital/escaneado e fotos com OCR local, evidência por página e região, senha transitória, progresso, cancelamento e limites de memória/tempo; evidência em documentos.md |
| #11 | PR #83 integrado com CI completa: sugestões por regras, edição, isolamento e modelo local opcional. O mantenedor informou não haver Ollama disponível; avaliação real e assistência à extração/mapeamento continuam pendentes (assistencia.md) |
| #12 | Concluída nos PRs #52 e #80, com serviço único e jornada de revisão/correção/confirmação/desfazer validada em dashboard, gráficos, tabelas, API e CSV em competência/caixa; CI completa aprovada |
| #13 | PR #55 entrega telas nativas, cache/rascunhos por usuário, replay idempotente e conflitos; este incremento acrescenta correção de campos e linhas inválidas na importação, salvamento explícito e bloqueio de confirmação com rascunhos pendentes (mobile.md). Validação iOS e jornadas restantes pendentes |
| #14 | Concluída no PR #57: CSV seguro, backup versionado do usuário, restauração com prévia/atomicidade, exclusão confirmada; evidência em dados.md |
| #15 | Concluída no PR #74: Pluggy, Uber, mapa/GPS, captura antiga e ingestão global removidos; dados históricos preservados e cobertos por consulta, CSV, backup e restauração |
| #16 | Gates e jornadas básicas existem; release/jornadas completas/mobile ainda pendentes |
| #17 | README atualizado; faltam capturas reais dos fluxos finais entregues |
| #18 | #1–#10, #12, #14, #15 e #38 completas; #11/#13 parciais; demais critérios permanecem nas respectivas issues |
| #19 | 1ª entrega em código: opt-in por app, parser versionado, staging em revisão idempotente, listener Android e sincronização com fila privada (captura.md). Faltam prova em aparelho Android, matriz de bancos com avisos reais e o conector de e-mail (só viabilidade) |
| #28 | URLs/cookies seguros e exceções locais definidas; falta comprovar transporte/redirects da implantação |
| #30 | MFA não implementado |
| #31 | Login tem rate limit; falta cobertura operacional de todas as superfícies/rajadas/recuperação |
| #32 | Schemas/limites existentes; cobertura completa das fronteiras precisa ser demonstrada |
| #33 | Inventário de HTML/Markdown/URLs/relatórios/downloads em ../security/output-safety.md, restrições de HTML bruto e E2E com payloads persistidos/XSS/CSV; fechamento depende do gate completo |
| #34 | Inventário de SQL direto/indireto, restrição de drivers no runtime, round-trip de valores hostis e recusa de identificadores externos; matriz em ../security/sql-injection.md, encerramento vinculado à integração com CI completa |
| #35 | Runbook de código/configuração/dados e ensaio de falha/rollback no emulador, ampliado para HTTP na imagem de produção; ../security/recovery.md. Fechamento depende do gate desse incremento |
| #37 | Inventário/procedimento em ../security/secrets.md e ensaio sintético de rotação de assinatura com sessões retidas, reset/revogação e finanças preservadas; fechamento depende do gate completo |
| #38 | Concluída no PR #54: allowlist CORS exata (somente AUTH_URL), preflight e origem negada antes da autenticação, inventário em cors.md |
| #39 | Logs de auth desativados para evitar vazamentos; trilha de eventos/retencão/correlação não entregue |
| #40 | SecureStore e hashes não comprovam criptografia de volumes, arquivos e backups |
| #41 | Inventário reproduzível de pacotes/Actions/imagens, hooks instalados, política de prazos e revisão de patches com expiração testada; ../security/dependencies.md, encerramento vinculado à integração com CI completa |
| #42 | PMP confirmado. Redução de permissões Android, guard do manifesto release, matriz e testes em ../security/least-privilege.md; production GitHub exige revisor/main/sem bypass. Listagem de contas IAM retornou 403: revisão efetiva da nuvem ainda pendente |
| #43 | Health endpoint não comprova métricas, alertas e simulações de incidentes |
| #44 | Responsável, RPO/RTO, contenção/rotação/restauração e ensaio com replay idempotente em ../security/recovery.md. Restore revoga credenciais e revalida grafo; fechamento depende do gate completo |
| #47 | Concluída no PR #48, com Firestore Enterprise em São Paulo, runtime/autenticação, regras, backup/reversão e CI incluindo Android nativo |

As issues só são encerradas após a CI completa do PR correspondente. O site ainda não está publicado: o workflow de deploy falha de propósito até o GCP ser provisionado. O provisionamento cabe em um comando no Cloud Shell (`scripts/deploy/provision-gcp.sh`, ver `docs/deploy/cloud-run.md#caminho-rápido-cloud-shell`).

O PR #84 é um complemento aberto de métricas com CI aprovada; a #12 já foi concluída pelos PRs #52/#80. O PR #83 continua sendo uma entrega parcial da #11: aprovação da CI deste incremento não comprova avaliação de modelo real nem autoriza encerrar a issue completa.
