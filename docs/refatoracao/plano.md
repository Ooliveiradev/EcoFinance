# Plano de implementação do EcoFinance

> Atualização em 06/10/2026: #1–#5, #29/#36 e #47 estão concluídas. PR #48 migrou o runtime para Firebase; PR #49 entregou o cadastro manual, ambos com CI completa aprovada. A retomada implementa o [planejamento mensal #6](planejamento.md), cuja integração e encerramento dependem dos gates do PR. Consultar a [revisão do backlog](estado-issues.md).

> Atualização em 05/10/2026: EF-01 (#1) concluída após os PRs #20/#27 integrados e CI remota aprovada; EF-02 (#2) já concluída. A entrega atual implementa EF-03 (#3), hash de senhas (#29) e expiração/revogação (#36); consulte [autenticação e evidências](autenticacao.md). Vincular issues completas no PR com Closes #N; somente o merge conclui as vinculadas. EF-04/EF-05 são as próximas entregas financeiras de interface. Os critérios anteriores e observações abaixo registram o diagnóstico histórico da base.

Data da revisão: 02/10/2026. Base local: `f0e085a`; árvore de trabalho limpa antes deste documento.

## Resultado pretendido e evidência

Entregar um gerenciador mensal personalizável na web e no Expo Android/iOS, com cadastro manual, planejamento, cartões, importação revisada, métricas corretas e recuperação dos dados. Open Finance, acesso a notificações, e-mail e IA externa não são requisitos para usar o produto.

Foram consultados os corpos das 19 issues abertas no GitHub: [#1 a #19](https://github.com/Ooliveiradev/EcoFinance/issues?q=is%3Aissue%20is%3Aopen). #18 é o acompanhamento agregador; #1–#17 são entregas; #19 acrescenta captura opcional. Este documento detalha a execução, sem marcar funcionalidade como entregue nem modificar issues.

A inspeção do código foi estática. Não executei o app, instalação, build, testes nem banco: `node_modules` está ausente. Portanto, falhas de execução e prazos permanecem a confirmar no primeiro incremento. A consulta semântica ao Jev falhou com `fetch failed`; nenhum julgamento do serviço foi utilizado.

| Evidência local | Impacto | Entrega responsável |
| --- | --- | --- |
| `packages/db/src/schema.ts`: três tabelas, sem proprietário, categorias enum | Não suporta isolamento nem planejamento | #2, #3 |
| Mesmo schema: exclusão de conta em cascade; externalId com índice comum | Pode perder histórico; não atende conflito do OFX | #1, #2, #8 |
| `import-ofx/route.ts`: grava conta/saldo antes das linhas; captura erro como skipped | Importação parcial pode parecer sucesso | #8, #9 |
| `ofx-parser.ts`: dinheiro como number e data curta substituída por hoje | Precisão e histórico podem ser alterados | #2, #9 |
| `app/page.tsx`: métricas por sinal e catch com dashboard vazio | Falha de banco parece saldo zero | #5, #12 |
| `expo/services/api-client.ts`: EXPO_PUBLIC_API_SECRET | Credencial global no cliente | #3, #15 |
| `notification-handler.ts`: expo-notifications, GPS e envio direto | Não demonstra leitura dos bancos nem staging | #19, #15 |
| Plugin de listener existe, mas não está listado no app.json; dependência nativa referenciada não aparece no package.json | Captura Android precisa prova de conceito em build próprio | #19 |
| Drizzle diferente em db e next; CI só typecheck; scripts db/mobile incompletos para verificações globais | Baseline não está comprovado | #1 |
| README ainda anuncia captura automática e funcionalidades legadas | Comunicação diverge do novo escopo | #17, desde a primeira entrega |

## Limites de conclusão

1. **Release principal:** concluir os critérios de #1–#17, incluindo formatos declarados, modo sem IA externa, mobile e restauração. Uma entrega menor pode ser publicada como beta explicitamente limitada; isso não fecha issues incompletas.
2. **Captura Android:** incremento opcional da #19, depois de autenticação, staging e revisão mobile. Não deve bloquear o uso manual nem a release principal se a prova de conceito revelar impedimento externo.
3. **E-mail e lançamento automático:** etapas posteriores da #19. E-mail faz parte do backlog; lançamento automático é uma evolução a avaliar, não promessa da primeira versão. #19 permanece aberta enquanto seus critérios acordados estiverem pendentes. #18 só fecha quando o escopo acompanhado estiver entregue; ampliar seu checklist para incluir #19 exige uma atualização explícita futura.

## Arquitetura a preservar

- `apps/next`: interface web e API; serviços de aplicação fazem autorização, transações e consultas. Componentes não duplicam regras financeiras.
- `apps/expo`: interface nativa, sessão segura, cache privado e rascunhos; consumo da mesma API. Banco do servidor continua sendo a fonte de verdade.
- `packages/shared`: contratos Zod, dinheiro exato, datas civis, calendário e regras puras de métricas/conciliação. Sem dependências do Next, banco ou módulos nativos.
- `packages/db`: schema, constraints e migrações versionadas. PostgreSQL/Drizzle continuam; sem troca de banco.
- Novo `packages/import`: registro de adaptadores, detecção, normalização e diagnóstico; PDF/OCR executados em worker separado da requisição web.
- Novo worker: fila persistida no PostgreSQL inicialmente, leases, tentativas limitadas e cancelamento; adapter de arquivos privados. Self-hosting sem serviços pagos obrigatórios.

Dinheiro: numeric no banco, string decimal nos contratos, centavos inteiros com limite validado ou decimal exato no domínio. BRL inicial; não converter outras moedas implicitamente. Datas de compra, competência, vencimento e pagamento são distintas de timestamps de auditoria.

Modelo inicial: usuários/sessões, contas, categorias, lançamentos e movimentos vinculados, auditoria e chaves idempotentes. Acrescentar recorrências/ocorrências/orçamentos, cartões/faturas/parcelas e importações nos incrementos correspondentes. Definir seus contratos no início, sem exigir toda a UI para liberar CRUD.

Transferência correlaciona duas pontas e não conta como receita/despesa. Compra de cartão é despesa por competência; pagamento da fatura liquida caixa/passivo. Saldo inicial não é receita. Previsão conciliada deixa de contar como pendente. Identidade externa tem escopo de usuário + conta + fonte + ID; fingerprint sugere duplicidade, não autoriza descarte.

## Sequência de PRs e critérios de saída

Cada PR precisa ficar executável e revisável. Uma issue ampla pode exigir vários PRs; fechá-la somente quando todos os seus critérios estiverem comprovados.

| PR | Issues | Mudança concreta | Evidência para concluir |
| --- | --- | --- | --- |
| 01 — Baseline | #1 | Instalação frozen-lockfile; alinhar Drizzle; verificar Expo e plugins; configurar lint e scripts por pacote; testes de domínio e PostgreSQL na CI | Checkout limpo passa tipos/lint/build aplicáveis; diagnóstico inicial registrado; teste reproduz conflito OFX |
| 02 — Migração segura | #1, #2 | Comando db:migrate versionado; bootstrap da migration SQL existente; fixture legada e relatório de diferenças; ensaio de backup/restore | Banco vazio e legado convergem; índices/extensões/triggers verificados; restauração aprovada |
| 03 — Domínio e propriedade | #2 | Usuário, contas/categorias editáveis, lançamentos, datas, dinheiro, ownership e auditoria; backfill com proprietário explicitamente indicado | Contagens/somas por conta e origem iguais antes/depois; FKs impedem vínculos entre usuários; conta arquivada preserva histórico |
| 04 — Sessões e autorização | #3, início #15 | Selecionar biblioteca self-hostable em ADR; cookie web e sessão revogável mobile; proteger SSR, API, uploads e chat; desativar ingestão antiga sem autorização adequada | Dois usuários não acessam recursos cruzados; logout/revogação/CSRF testados; nenhum segredo global nos bundles |
| 05 — Primeiro fluxo completo | #4, #5, início #12/#13 | Navegação mensal, conta/categoria/receita/despesa/transferência CRUD, filtros e paginação; Meu mês com métricas básicas; login e gasto rápido Expo | Criar → recarregar → editar → excluir atualiza totais; R$ 0,10 + R$ 0,20 = R$ 0,30; web/mobile leem o mesmo lançamento |
| 06 — Planejamento | #6, parte #12/#13 | Regras recorrentes, ocorrência mensal única, pagar/adiar/pausar, orçamento e renda prevista; projeção compartilhada | Dia 31 e ano bissexto corretos; pagamento não duplica previsto; execução concorrente cria uma ocorrência |
| 07 — Cartões e conciliação | #7, parte #12/#13 | Cartão, fechamento, fatura, parcelas, estorno, juros/créditos e pagamento parcial; vínculos de conciliação | Compra 300 em 3x100 soma 300 por competência; pagar fatura não cria despesa adicional; totais e divergências explícitos |
| 08 — Pipeline comum | #8 | Lotes/itens, estados, uploads privados e limites, revisão/correção, confirmação transacional, cancelamento/reversão; adapter OFX inicial | Prévia não altera saldo; duas confirmações produzem um commit; falha não deixa lançamento parcial; undo respeita edição posterior |
| 09 — Formatos estruturados | #9 | OFX/QFX SGML/XML, CSV/TSV, XLS/XLSX; detecção por conteúdo, mapeamento salvo, abas, evidência por linha/célula | Corpus por formato confere valores e contagens; datas ambíguas exigem correção; erros não somem como skipped |
| 10 — Métricas e relatórios | concluir #12, partes #4/#13 | Serviço único de agregação; competência/caixa, categorias, evolução, previsto/realizado e fixos/variáveis; invalidação após mutações | Tabela, gráficos, cartões e exportação coincidem no mesmo filtro; falha real não vira zero; sem base anterior não inventa tendência |
| 11 — Documentos | #10 | Worker, texto/coordenadas PDF, renderização+OCR de scans/imagens, reconstrução multipágina, senha transitória, progresso/cancelamento | PDF digital/scan e PNG/JPEG/WebP com origem por item; limites/timeout/rotação/desfoque testados; sem bloquear API |
| 12 — Assistência opcional | #11 | Adaptadores sem IA, modelo local no servidor e externo opt-in; regras editáveis e saída validada; chat usa métricas autorizadas | Sem chave continua funcional; timeout/injection não escreve dados; corpus mede erros por campo; hardware local documentado |
| 13 — Paridade mobile | concluir #13 | Planejamento, cartões e importação/revisão nativos; seletor de arquivos, SecureStore, cache/rascunhos por usuário, replay idempotente e conflitos | Jornadas Android/iOS, sessão expirada, offline/reconexão e logout; builds instaláveis; nenhuma tela essencial depende da web |
| 14 — Dados e transição | #14, concluir #15 | CSV seguro, backup completo versionado, restore com prévia/atomicidade, retenção/exclusão; retirar Pluggy/GPS/mapa/Uber e ingestão global após substitutos | Round-trip preserva totais/vínculos; restore interrompido não corrompe; legado exportável; fluxo principal sem chaves externas |
| 15 — Captura Android | parte #19 | PoC nativa e depois serviço/fila privada, fontes opt-in e parsers versionados; eventos entram no staging #8; revisar na web/mobile | JS inativo, reinício/rede/revogação e dois cliques verificados em aparelho; recusas/transferências/faturas não viram despesas indevidas |
| 16 — Release verificável | #16, #17 | Jornadas finais, acessibilidade, desempenho, self-hosting, deploy/builds e rollback; README e screenshots reais | Matriz completa aprovada; ambiente/commit registrados; documentação anuncia só recursos demonstrados |
| 17 — Conector de e-mail | parte restante #19 | ADR do primeiro provedor, OAuth/revogação, sync incremental no servidor, filtros e evidência mínima; conciliação com arquivo/manual/Android | Repetição/ordem/timeout/quota e desconexão testados; caixa não alterada; critérios externos de publicação resolvidos |

A numeração é ordem preferencial de integração, não exige trabalho sequencial em toda a implementação. #4 começa após PR01 e termina com as telas posteriores. #12 começa no PR05: números úteis não esperam importação; seu aceite completo continua após planejamento/cartões/parsers. #13 começa no PR04/05 e termina após documentos/revisão. A preparação de #14 começa no PR02 com recuperação operacional; backup completo da aplicação depende do modelo e staging finalizados.

PR11 e PR09 podem evoluir independentemente após PR08. Estrutura mobile evolui com cada contrato estável. PoC Android pode começar depois de PR04, mas a captura utilizável exige PR08 e revisão mobile. Essas oportunidades descrevem dependências técnicas, sem pressupor agentes adicionais ou equipe disponível.

## Primeiro incremento executável

Objetivo imediato: sair de uma base não verificada para **login → criar conta → criar categoria → registrar R$ 42,90 → consultar Meu mês → editar → sincronizar no Expo**.

1. PR01 registra versões do runtime, resultado de install/tipos/lint/build e falhas preexistentes; não atualiza o monorepo inteiro por conveniência.
2. PR02 estabelece db:migrate e banco descartável na CI. Reproduzir a falha de conflito OFX; corrigir no novo modelo com constraint de escopo, não índice global improvisado.
3. PR03 publica contratos Account, Category, Entry, Money e CivilDate; migration aditiva e fixture de backfill. IDs/categorias/origens legadas têm mapeamento rastreável.
4. PR04 decide autenticação antes de implementar telas de login. ADR compara suporte real a Next/Expo, revogação por dispositivo, manutenção, recuperação e operação self-hosted.
5. PR05 entrega endpoints autenticados de contas/categorias/lançamentos e consulta mensal, formulário web e primeiro fluxo Expo. Escritas recebem chave idempotente; edições usam versão para detectar conflito.

Contrato inicial sugerido: `GET/POST /api/accounts`, `GET/POST /api/categories`, `GET/POST /api/entries`, `PATCH/DELETE /api/entries/:id`, `GET /api/months/:month/summary`. Usuário vem exclusivamente da sessão. Filtros/limites são validados no servidor. Erros distinguem entrada inválida, sessão expirada, conflito e indisponibilidade.

Depois: `/api/recurrences`, `/api/budgets`, `/api/cards`, `/api/invoices`, `/api/imports` e ações review/confirm/revert; `/api/capture/events` produz sugestões, nunca despesas diretas. Nomes finais são contratos de implementação, não rotas já existentes.

## Migração e operação

Expandir → backfill → validar → trocar fluxos → desativar escritores antigos → retirar estruturas em migration posterior. Não executar db:push em produção como caminho de release.

- Antes de migrar dados reais: snapshot, restauração em banco isolado e associação explícita ao proprietário.
- Verificar contagens, somas exatas, datas e origens por conta; duplicados existentes são relatados antes da constraint única. Discrepância bloqueia avanço.
- Identificar FKs com cascade e preservar vínculos legados durante transição. Arquivar contas/categorias é o padrão.
- PostGIS e metadados Uber podem permanecer históricos até exportação/migração comprovadas; a nova aplicação não depende deles.
- Desligar ingestão global antiga antes de exposição pública. Ao substituir notificações, não reutilizar credencial embutida nem escrita imediata.
- Rollback usa aplicação compatível com schema expandido ou snapshot restaurado; ensaiar antes de publicar.

## Matriz mínima de validação

| Área | Casos obrigatórios |
| --- | --- |
| Dinheiro e calendário | Centavos exatos, limites, valores inválidos, BRL, datas ambíguas, dia 31, bissexto, virada de mês/ano |
| Semântica financeira | Saldo inicial, transferência própria, recorrência paga/conciliada, parcelas, estorno parcial, pagamento parcial de fatura |
| Ownership | Dois usuários; IDs cruzados; sessão ausente/expirada/revogada; arquivo, exportação, chat e referências entre entidades |
| Concorrência | CRUD repetido, confirmação dupla, retries após timeout, geração recorrente simultânea, conflito web/mobile |
| Importação | Todos os formatos com fixtures sintéticas; extensão incorreta; encoding; múltiplas abas/páginas; senha; arquivo vazio/corrompido; limite/cancelamento |
| Recuperação | Migração legada, backup/restore em instalação vazia, restore interrompido, reversão após edição, expiração de originais |
| Interface | 360/768/1440, teclado/foco/leitor de tela, zoom 200%, contraste, resumo dos gráficos, erro/offline/vazio verdadeiros |
| Mobile | Build próprio Android/iOS, arquivo/revisão, retomada de rede, rascunho isolado, logout e sincronização |
| Captura | Opt-in/revogação, JS inativo, fila após reinício, fonte desabilitada, eventos repetidos, duas compras iguais legítimas, sem GPS |

Adicionar testes quando protegem regras e falhas reais: Vitest para domínio/parsers, integração com PostgreSQL real descartável, Playwright para jornadas web e suíte mobile a selecionar no baseline. CI roda tipos/lint/build, domínio e integração em cada PR; jornadas do fluxo alterado antes de integrar; matriz de release completa no gate final. Registrar ambiente e não transformar limitações de hardware em testes presumidamente aprovados.

Corpus de documentos: fixtures sintéticas com resultado esperado, evidência de origem e diagnósticos. Suporte é por formato **e layout validado**; não declarar suporte universal. Para OCR/modelo local, medir tempo/memória/erros no hardware disponível antes de definir limites e metas de desempenho.

## Decisões e impedimentos a resolver

| Decisão | Momento | Padrão proposto / saída exigida |
| --- | --- | --- |
| Biblioteca de autenticação e recuperação | PR04 | Self-hostable, mantida, integração web/mobile comprovada em PoC e ADR |
| Presença de dados legados reais | PR02/03 | Sem dados reais usar fixture; com dados reais exigir proprietário explícito e snapshot restaurável |
| Bibliotecas de planilha/PDF/OCR | PR09/11 | Benchmark de corpus, licença, manutenção e limites; nenhuma escolha é promessa de compatibilidade universal |
| Disponibilidade de macOS/build e aparelhos iOS | Antes do gate mobile | Usar infraestrutura adequada; sem validação iOS, plataforma e issue ficam pendentes |
| Infraestrutura e distribuição | PR16 | Self-hosted reproduzível; orçamento explícito para hosting/build/lojas; sem presumir serviço ilimitado grátis |
| Fontes Android iniciais | PoC #19 | Escolher 2–3 apps conforme aparelhos/exemplos disponíveis; publicar matriz de versões/layouts testados |
| Retenção de documentos/evidências | Antes de uploads/captura | Proposta inicial: temporários 24h, originais 7 dias configuráveis; metadados/auditoria mínimos separados. Confirmar comportamento no produto antes de produção |
| Provedor e-mail e sync | PR17 | Gmail como candidato; menor escopo adequado, requisitos de publicação verificados; começar incremental agendado, se PoC confirmar viabilidade |
| Lançamento automático | Após captura revisada validada | Fora da primeira entrega; regra explícita com conta/campos completos, auditável e reversível; ambiguidades voltam à revisão |

Não fixar calendário antes do PR01 e das PoCs de documentos/native mobile. Estimar cada PR em esforço após conhecer falhas reais e corpus; separar esforço da equipe de esperas por hardware, provedores e lojas. Marco principal só termina quando seus critérios passam, não por número de issues fechadas.

## Acompanhamento

Para cada PR registrar: issues atendidas, critérios restantes, comandos e ambiente de validação, evidências, risco de migração e rollback. Atualizar README continuamente; capturas públicas somente da execução validada com dados sintéticos e commit identificado.

No fechamento, conferir checklist de cada issue contra evidências. #18 agrega o estado sem contar como implementação adicional. #19 tem progresso separado Android/e-mail/automação; nenhuma entrega parcial equivale a concluir todo o backlog.
