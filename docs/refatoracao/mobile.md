# Aplicativo de gestão Android e iOS — EF-13 (#13)

Atualizado em 07/10/2026. Este documento cobre o incremento entregue como **Parte de #13**. Ele descreve as jornadas nativas, a camada de dados e sessão do Expo e as pendências para fechar a issue. Não certifica produção nem build iOS assinado.

## Decisão

O app Expo (`apps/expo`) passa a ser um cliente de gestão completo. Ele consome as mesmas APIs autenticadas da web, por `Authorization: Bearer`, e não duplica regra financeira:

- validação de formulários com os schemas Zod de `@ecofinance/shared` (`manualEntrySchema`, `manualAccountSchema`, `manualCategorySchema`, `budgetPlanSchema`, `paymentSchema`, `postponementSchema`, `ruleChangeSchema`, `cardSchema`, `cardPurchaseSchema`, `invoicePaymentSchema`, `importReviewSchema`);
- prévia de parcelas com `installmentPlan`, limites de upload com `IMPORT_LIMITS`, navegação mensal com `shiftMonth`/`monthLabel`/`currentMonthParam`/`civilToday`, formatação com `formatCents`;
- todos os totais (mês, projeção, categorias, planejamento, fatura, prévia de importação) chegam calculados pelo servidor, com as mesmas funções puras que a web usa. O telefone só exibe.

Captura de notificações bancárias, localização (GPS) e conexão Pluggy foram **removidas** do app: telas `home`/`accounts`/`ai`, `location-service`, plugin de notification listener e as dependências `expo-location`, `react-native-pluggy-connect`, `react-native-webview` e `expo-intent-launcher`. As permissões de localização saíram do `AndroidManifest.xml` e ficaram bloqueadas em `app.json` (`android.blockedPermissions`). A tarefa legada de notificação continua só para ser desregistrada em instalações antigas (`disableLegacyCapture`).

## Jornadas cobertas

| Jornada | Tela | API | Situação |
| --- | --- | --- | --- |
| Login, sessão expirada e logout | `auth/login`, `settings` | `/api/auth/*` | Entregue |
| Meu mês: receitas, despesas, resultado, saldo, projeção e despesas por categoria | `month` | `GET /api/reports?from&to&basis=competence` | Entregue |
| Lançamentos: listar por mês, criar, editar, excluir e restaurar (receita, despesa, transferência) | `entries`, `entry-form` | `/api/entries`, `/api/entries/:id` | Entregue |
| Contas e categorias: listar com saldo, criar, editar, arquivar e restaurar | `references` | `/api/accounts`, `/api/categories` | Entregue |
| Planejamento: orçamento do mês, previstos (pagar, adiar, cancelar, restaurar), gerar previstos, nova recorrência | `planning` | `/api/planning/:month`, `/api/occurrences/:id/:action`, `/api/recurrences` | Entregue |
| Cartões e faturas: cadastrar cartão, ver fatura do mês com totais e divergência, compra parcelada com prévia, pagar fatura | `cards` | `/api/cards`, `/api/cards/:id/invoices/:month`, `/api/cards/:id/purchases`, `/api/invoices/:id/pay` | Entregue |
| Importação: seletor de arquivos, destino conta/cartão, análise no servidor, revisão por linha (categoria, criar/vincular/excluir), confirmar, desfazer e cancelar | `imports` | `/api/imports`, `/api/imports/:id/:action`, `/api/imports/:id/items/:itemId` | Entregue (requer conexão) |
| Pendências e conflitos | `pending` | — | Entregue |

O mesmo lançamento aparece igual na web e no celular depois da sincronização, porque ambos leem as mesmas rotas e o mesmo cálculo.

## Dados e sessão

Código em `apps/expo/src/data`:

| Arquivo | Responsabilidade |
| --- | --- |
| `api.ts` | Cliente HTTP. Envia `Idempotency-Key` e `If-Match` (entre aspas, como a web) e classifica falhas em `offline`, `expired`, `conflict`, `invalid`, `not-found`, `forbidden` e `unavailable`. |
| `cache.ts` | Rede primeiro. Só falha de conexão ou 5xx/429 cai para a última cópia confirmada **do mesmo usuário**. Sem cópia, a tela mostra o erro. |
| `outbox.ts` | Rascunhos e alterações pendentes por usuário, com replay ordenado e idempotente. |
| `session.ts` | Logout, saída offline e limpeza de dados de outra conta. |
| `local-store.ts` | Namespace `ecofinance.u.v1.<userId>.*` no AsyncStorage. |

### Cache e rascunhos privados por usuário

- A credencial fica só no SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), como antes.
- Cache e rascunhos ficam no AsyncStorage, com chave prefixada pelo `userId`. Ao entrar com outra conta, `prepareUser` apaga os dados de qualquer conta anterior antes de mostrar a nova.
- O formulário de lançamento novo é salvo localmente a cada alteração (`draft.entry-form`) e restaurado ao reabrir.

### Pendente × sincronizado

- Toda gravação passa pela outbox. Quando o servidor confirma, o item sai da fila e as telas releem os dados.
- Sem conexão, a alteração fica **pendente**. Ela aparece em “Ainda não sincronizados” (lançamentos), em badges por registro e em Mais › Pendências. Os totais exibidos nunca incluem pendências; Meu mês avisa quantas existem.
- Uma tela servida do cache mostra “Mostrando cópia salva em dd/mm hh:mm” com o motivo. Sem cópia, mostra o erro real (“Sem conexão e sem cópia salva”), nunca uma lista vazia ou R$ 0,00. Valores ausentes (saldo sem saldo inicial, projeção sem orçamento) aparecem como “indisponível”.

### Replay idempotente

- Cada intenção recebe um `Idempotency-Key` (UUID v4 de `expo-crypto`) quando entra na fila. Todo reenvio da mesma intenção usa a mesma chave e o mesmo `If-Match`. Se a resposta se perdeu, o servidor devolve o primeiro resultado (`operation` em `finance-operation.ts`) em vez de aplicar duas vezes.
- A tentativa é registrada **antes** do envio (write-ahead). Uma intenção que pode ter chegado ao servidor não é mais editada, só reenviada ou descartada. Uma intenção nunca enviada pode ser substituída; nesse caso ganha chave nova.
- O replay acontece ao abrir o app, ao voltar para primeiro plano (`AppState`), ao salvar e no botão “Sincronizar agora”. É ordenado e para na primeira falha de conexão, para que uma alteração posterior não ultrapasse uma anterior. Execuções concorrentes são serializadas.
- Um rascunho só é reenviado com a credencial da conta que o criou (`backendFetch(..., expectedUserId)`).
- Importação não entra na fila: upload, revisão e confirmação exigem conexão. Ainda assim, cada ação mantém uma chave por intenção (`intentKey`), e repetir após perda de resposta não duplica lote nem commit.

### Conflito por `If-Match`

- `409 REVISION_CONFLICT` marca a alteração como **conflito** sem bloquear as outras.
- Em Pendências, “Ver versão atual do servidor” lê o registro atual (lançamento, conta, categoria, cartão, previsto, orçamento ou fatura). A pessoa escolhe entre “Aplicar minha alteração sobre esta versão”, que reenvia com a revisão revisada e chave nova, e “Descartar minha alteração”.
- Outras recusas (400, `LINKED_ENTRY`, `ARCHIVED_REFERENCE`, mês fechado etc.) ficam como **recusadas**, com a mensagem do servidor. Rascunhos de lançamento recusados podem ser corrigidos no formulário.

### Sessão expirada e logout

- Um 401 apaga só a credencial daquela sessão (comportamento já existente) e volta ao login. Rascunhos e cache são mantidos: o login avisa quantas alterações continuam pendentes e as envia ao entrar com a mesma conta. Uma requisição 401 não é contada como tentativa, porque nada foi aplicado.
- Ao abrir o app sem rede com uma sessão salva, o app entra em modo cópia salva (sem validar a sessão). O primeiro 401 posterior volta ao login.
- “Sair deste dispositivo” e “Sair de todos” revogam no servidor primeiro e depois apagam cache e rascunhos do usuário. Se a revogação falha (offline), nada local é apagado e a ação pode ser repetida. Existe também “Sair só deste aparelho”, que apaga credencial e dados locais sem contatar o servidor; a sessão remota continua válida até expirar ou ser revogada em outro dispositivo. As duas saídas avisam quantas alterações não sincronizadas serão perdidas.

## Acessibilidade

Os componentes nativos (`src/ui/kit.tsx`) usam `accessibilityRole` (`header`, `button`, `radio`/`radiogroup`, `alert`), `accessibilityState` e rótulos falados nas linhas de valores. O gráfico de despesas por categoria é uma barra horizontal cujo rótulo traz o valor e o percentual, então a cor nunca é o único sinal. As áreas de toque têm no mínimo 48 dp.

## Builds, assinatura e distribuição

| Plataforma | Estado | Como gerar |
| --- | --- | --- |
| Android | O CI compila `assembleDebug` e roda `lintDebug` (`apps/expo/android`). O bundle JS de Android e iOS é exportado por `pnpm --filter @ecofinance/expo build`. | APK local: `pnpm --filter @ecofinance/expo android` com emulador; APK instalável: `eas build -p android --profile preview` (perfil `preview` em `eas.json` gera APK de distribuição interna). |
| iOS | `bundleIdentifier` `com.ecofinance.app` e `usesNonExemptEncryption: false` definidos em `app.json`. **Não validado**: não há macOS neste ambiente. | Simulador: `pnpm --filter @ecofinance/expo ios` em um Mac com Xcode. Dispositivo/TestFlight: `eas build -p ios --profile preview` (ad hoc) ou `production` + `eas submit`. |

- **Assinatura Android:** o CI gera uma chave de debug descartável. Para distribuição, use credenciais gerenciadas pelo EAS ou um keystore próprio fora do repositório; `*.keystore`/`*.jks` são bloqueados por `security:source`.
- **Assinatura iOS:** exige Apple Developer Program. O EAS cria certificados e perfis de provisionamento; para ad hoc, registre os UDIDs dos aparelhos.
- **Segredos:** o build não contém segredo global. A única configuração pública é `EXPO_PUBLIC_API_URL`, que preenche o campo Servidor do login. `build-with-canaries.mjs mobile` continua verificando que credenciais de servidor não entram no bundle.
- **Custos externos:** Apple Developer Program, US$ 99/ano (obrigatório para dispositivo físico fora do Xcode pessoal, TestFlight e App Store); Google Play Console, US$ 25 uma vez (só para publicar na loja; APK interno não exige); EAS Build tem plano gratuito com fila e cota mensal limitadas, e builds além disso são pagos. Nenhum custo é obrigatório para rodar no emulador Android.

## Validação

Testes vitest da camada de dados e sessão (`apps/expo/src/**/*.test.ts`, na suíte `pnpm test`):

- `api.test.ts`: headers `Authorization`/`Idempotency-Key`/`If-Match`, query codificada e classificação de 400/403/404/409/5xx, rede, timeout e 401.
- `cache.test.ts`: cópia por usuário, rotulada como cache quando offline; erro sem cópia (sem zeros); conflitos e validação nunca mascarados; limpeza por usuário e por troca de conta.
- `outbox.test.ts`: pendente offline e replay com a mesma chave; resposta perdida reenviada com a mesma chave e o mesmo `If-Match`; intenção enviada não é editada; conflito e `reapply` com revisão nova; recusa corrigível; ordem preservada; sessão expirada sem contar tentativa; isolamento por usuário; replays concorrentes com um único envio; recusa de reenvio com credencial de outra conta.
- `session.test.ts`: logout revoga e depois limpa; falha de rede mantém os dados; saída offline limpa e notifica; troca de conta não herda dados.
- `entries.test.ts` e `journeys.test.ts`: entrada de valores em pt-BR sem ponto flutuante (R$ 0,10 + R$ 0,20 = R$ 0,30), payloads validados pelos schemas compartilhados para lançamentos, contas, categorias, orçamento, previstos, recorrências, cartões, compra 300 em 3x100, pagamento de fatura, limites e multipart de importação e chave por intenção.

React Doctor (`npx react-doctor@0.9.14 apps/expo`): 100/100, sem achados.

## Pendências para concluir a #13

- **iOS:** gerar e testar no simulador e em dispositivo (exige macOS/Xcode ou EAS com conta Apple). Nada foi executado em iOS neste incremento.
- **Dispositivo e emulador Android:** o CI compila o APK de debug; a execução manual das jornadas em emulador/aparelho e a gravação de evidências ainda não foram feitas neste incremento.
- **E2E mobile:** não há suíte (Maestro ou Detox). Ela deve cobrir login, sessão expirada, offline/reconexão, conflito entre dispositivos, arquivos e leitores de tela (TalkBack/VoiceOver).
- **Detecção de rede:** a reconexão é tentada ao abrir, voltar ao primeiro plano, salvar e manualmente. Um listener de rede (`@react-native-community/netinfo`) aceleraria o replay.
- **Cache em repouso:** o AsyncStorage fica no sandbox do app, sem criptografia própria. `allowBackup=false` cobre o Android; no iOS, os arquivos podem entrar no backup do aparelho. Avaliar criptografia com chave no SecureStore ou exclusão do backup.
- **Funções ainda só na web:** limites por categoria no orçamento (preservados ao editar no telefone), fechar/reabrir mês, copiar plano, editar e pausar recorrências, itens de fatura (juros, tarifa, crédito, estorno), conciliação de cartão, repetir importação e edição de campos de uma linha importada.
- **Lembretes locais:** opcionais na issue, não implementados.
- **Seletor de data nativo:** as datas são digitadas como `AAAA-MM-DD` e validadas pelo schema compartilhado.

### Mudanças de API sugeridas (não implementadas)

Este incremento não altera `apps/next` nem `packages/db`. Para os próximos passos:

- `GET /api/recurrences` para listar regras (hoje elas chegam embutidas em `/api/planning/:month`).
- Expor `invoiceId`, `installmentId` e `recurrenceOccurrenceId` em `GET /api/entries`, para o app desabilitar a edição de lançamentos vinculados antes do envio, em vez de depender do `409 LINKED_ENTRY`.
- `If-Match` opcional em `POST /api/cards/:id/purchases` e em `/api/planning/:month/generate`, para que conflitos de fatura e mês fechado sejam detectados pela revisão, como nas demais escritas.
