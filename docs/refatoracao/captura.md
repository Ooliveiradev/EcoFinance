# Captura de gastos por notificações (#19)

Atualizado em 29/10/2026. Primeira entrega em código da captura **opcional** por
notificações Android. Não certifica funcionamento em aparelho: ver
[Pendências](#pendências). O conector de e-mail está só na
[análise de viabilidade](#e-mail-viabilidade).

## Como funciona

1. **Desligada por padrão.** Em Mais › Captura de gastos (app Android), a pessoa lê
   que o Android dá acesso às notificações de **todos** os apps, abre a tela do
   sistema para autorizar e escolhe os apps bancários. Para cada app ela escolhe a
   conta ou o cartão. O nome do banco escrito no aviso nunca define o destino.
2. **Filtro no aparelho.** O `CaptureListenerService` (módulo local
   `apps/expo/modules/ecofinance-capture`) descarta, antes de gravar:
   - pacotes não escolhidos;
   - avisos sem texto visível (conteúdo oculto não é reconstruído);
   - resumos de grupo;
   - textos com código, senha, token ou OTP.

   O que sobra vai para uma fila privada (`SharedPreferences` do app, sem backup),
   marcada com o usuário logado.
3. **Envio.** Ao abrir o app, ao voltar ao primeiro plano, no “Sincronizar” e em
   “Enviar avisos agora”, até 50 avisos vão para `POST /api/captures/events` com
   chave idempotente por lote. Sem rede, a fila espera com backoff exponencial (1 min
   até 1 h). Sessão expirada não conta tentativa. Lote recusado é descartado após 8
   tentativas e a tela informa. A fila guarda até 200 avisos; acima disso os mais
   antigos saem e a tela mostra quantos.
4. **Staging no servidor.** Cada aviso é lido pelo parser versionado
   `generic-ptbr@1` (`packages/shared/src/capture.ts`) e vira, no máximo, uma linha de
   um lote de importação em **revisão** (`source: notification`). Daí em diante o
   fluxo é o mesmo da importação (#8): corrigir, escolher categoria, vincular a
   lançamento existente, excluir, confirmar e desfazer. Os totais só mudam na
   confirmação.

## Regras do parser `generic-ptbr@1`

| Aviso | Resultado |
| --- | --- |
| Compra aprovada/realizada | Despesa (valor negativo) |
| Compra recusada, negada, não autorizada ou cancelada | Descartado |
| Pagamento de fatura | Descartado (a fatura é paga no fluxo de cartões, sem somar despesa) |
| Estorno/reembolso | Crédito, com aviso para conferir a compra original |
| Pix/transferência enviado | Saída, com aviso: entre contas próprias não é despesa, exclua a linha |
| Pix/transferência recebido | Entrada, com aviso de possível dinheiro próprio |
| Código, senha, token, OTP | Descartado (também no aparelho) |
| Aviso não financeiro | Descartado |

- Valor: o “de R$ X” explícito, ou o único valor que não esteja junto de limite,
  saldo, disponível, cashback ou desconto. Mais de um candidato deixa o valor vazio
  e pede preenchimento. Precisão decimal exata (`1.234,56` → `-1234.56`).
- Estabelecimento, destino ou origem só quando o texto traz. Sem isso, a descrição
  fica vazia e a linha fica inválida até a pessoa preencher.
- Data: a data escrita no aviso; sem ela, a data local (America/Sao_Paulo) do aviso,
  com alerta. A competência segue a data da compra e pode ser editada.
- Parcelado: alerta “confira se o valor é da parcela ou o total”. Parcelas futuras
  não são criadas.
- Texto de aviso é dado: instruções escritas nele não mudam valor nem destino.

**Não há layouts por banco.** Sem avisos reais disponíveis, o parser é genérico e
foi validado só com o corpus sintético de `capture.test.ts`. Os pacotes listados
na tela (Nubank, Itaú, Inter, Bradesco, BB, PicPay, Mercado Pago) facilitam a
escolha; a opção “Outro app” aceita qualquer pacote. A matriz de bancos suportados
só pode ser publicada depois da prova em aparelho com avisos reais.

## Identidade, duplicidade e concorrência

- Identidade do aviso: usuário + aparelho + pacote + chave da notificação + instante
  de postagem (o Android reaproveita chaves). Fica em `importItems.externalId`. Um
  aviso já recebido é contado como repetido e não gera outra linha.
- O lançamento confirmado recebe o id determinístico da importação (`source` +
  `externalId`). Confirmar o mesmo aviso duas vezes, ou duas confirmações
  concorrentes, gera no máximo um lançamento.
- Duas compras legítimas de mesmo valor no mesmo lugar têm chaves ou instantes
  diferentes e continuam duas linhas. A revisão só aponta “possível duplicata”.
- Uma notificação atualizada pelo app do banco com novo instante chega como aviso
  novo; a revisão mostra a duplicata provável para excluir ou vincular.

## Privacidade e isolamento

- Fila, filtros e destino pertencem a um usuário. Login de outra conta, logout e
  “sair só deste aparelho” apagam a fila e os filtros (`session.ts`).
- O servidor guarda só o trecho do aviso (até 200 caracteres) como evidência da
  linha. Avisos descartados não são gravados.
- Fontes: `settings.captureSources` no documento de preferências (backup, restauração
  e exclusão de dados já cobrem). Remover todos os apps pausa a captura no servidor
  para todos os aparelhos; o aparelho também para de guardar.
- A captura não chama IA: só as regras de categoria do usuário sugerem.
- O manifesto não ganha `uses-permission`. O serviço é exportado apenas com
  `BIND_NOTIFICATION_LISTENER_SERVICE`, que só o sistema usa; o guard de release
  aceita exatamente esse componente ([menor privilégio](../security/least-privilege.md)).
- iPhone e web não oferecem captura: o iOS não dá acesso às notificações de outros
  apps. A web lista e remove os apps habilitados e revisa as sugestões em
  Importações.

## API

- `GET /api/captures/sources` → `{ sources }`.
- `PUT /api/captures/sources` `{ sources: [{ package, label, accountId | cardId }] }`
  (`Idempotency-Key`). Conta/cartão precisam existir e ser do próprio usuário.
- `POST /api/captures/events` `{ deviceId, events: [{ package, key, postedAt, title, text }] }`
  (até 50, 64 KiB, `Idempotency-Key`) → `{ batches, accepted, repeated, ignored }`.

## Validação feita

- `packages/shared/src/capture.test.ts`: 13 testes com corpus sintético (compra,
  recusa, estorno, Pix enviado/recebido, fatura, parcela, múltiplos valores, limite e
  saldo, valor/estabelecimento ausentes, data no texto e virada de ano, fuso,
  injeção) e contratos.
- `packages/db/tests/captures.firebase.test.ts` (emulador Firestore): sem app
  habilitado nada entra; descarte antes de gravar; zero lançamentos até confirmar;
  retry/replay; confirmação concorrente gera um lançamento; duas compras iguais
  legítimas; campos sem evidência; isolamento entre usuários; pausa.
- `apps/expo/src/data/capture.test.ts` e `session.test.ts`: lote idempotente,
  backoff, sessão expirada, descarte após o limite, conta trocada e logout apagando
  a fila.
- `scripts/security/android-permissions.test.mjs`: aceita só o listener com a
  permissão do sistema.
- Build nativo Android local (`assembleDebug`, `lintDebug`, manifesto release) com
  o módulo: ver o PR.

## Pendências

- **Prova em aparelho**: listener com app fechado, revogação do acesso, fila após
  reinício, rede ausente e tela bloqueada. Este computador tem o SDK, mas a
  virtualização está desligada na BIOS (sem emulador) e não há aparelho conectado.
- **Matriz de bancos**: avisos reais anonimizados dos 2–3 primeiros bancos, layouts
  dedicados e métricas de extração antes de anunciar suporte.
- **Saúde no servidor**: a tela mostra o estado do aparelho; a web ainda não mostra
  o último aviso recebido por aparelho.
- **Lançamento automático**: fora desta entrega, como a issue define.

## E-mail: viabilidade

Decisão de 29/10/2026: documentar antes de implementar. Nada abaixo está
implementado.

| Tema | Gmail (candidato) |
| --- | --- |
| Escopo mínimo | `gmail.readonly` (restrito). `gmail.metadata` não lê o corpo, e o valor e o estabelecimento estão no corpo. Filtrar por remetente/rótulo reduz o processamento, mas **não** o alcance do escopo |
| Verificação | Escopo restrito exige verificação do app pelo Google e, para uso público, avaliação de segurança anual por laboratório credenciado (custo pago pelo operador). Para uso pessoal, um projeto “Em teste” limita a 100 usuários de teste e os tokens expiram em 7 dias |
| Sincronização | Opção A: `history.list` agendado (ex.: a cada 15 min, Cron da Vercel), sem Pub/Sub. Opção B: `users.watch` + Pub/Sub com renovação a cada 7 dias e recuperação por `historyId`. A opção A é mais simples e barata para poucos usuários |
| Tokens | Refresh token cifrado no servidor, revogação ao desconectar, jobs pendentes param na revogação |
| Efeitos | Só leitura: não marcar como lido, não arquivar nem apagar |
| Reuso | Mesmo `receiveCaptures` com `source` de e-mail; anexos PDF/imagem pelos parsers/OCR da #10 |

Antes de implementar: decidir entre uso pessoal (projeto em teste) e público
(verificação e avaliação paga), escolher o agendamento e definir a retenção das
evidências. O produto principal continua funcionando sem e-mail.
