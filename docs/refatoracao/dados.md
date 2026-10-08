# Dados: exportação, backup, restauração e exclusão (#14)

A área **Configurações → Seus dados** (`/settings`) permite levar os dados
embora, recuperar um estado anterior e apagar dados ou a conta. Tudo passa por
APIs autenticadas, filtradas pelo proprietário da sessão (cookie ou bearer, o
mesmo contrato do Expo). Nenhuma rota aceita `ownerId` do cliente.

| Método | Rota | Uso |
|---|---|---|
| GET | `/api/data` | Contagens por coleção, revisão dos dados, originais de importação retidos e limites |
| GET | `/api/data/entries?from=AAAA-MM-DD&to=AAAA-MM-DD` | CSV de lançamentos (período opcional) |
| GET | `/api/data/backup` | Backup completo versionado (JSON) |
| POST | `/api/data/restore/preview` | Prévia validada; não altera nada |
| POST | `/api/data/restore` | Restauração atômica (`Idempotency-Key` + `If-Match`) |
| POST | `/api/data/delete` | Exclusão de dados ou da conta (`If-Match` + confirmação digitada) |
| DELETE | `/api/data/originals/{id}` | Apaga só o arquivo original de um lote de importação |

As respostas usam `Cache-Control: private, no-store`; downloads têm
`Content-Disposition: attachment` e `X-Content-Type-Options: nosniff`. Erros
seguem `financeError`: código e mensagem genérica, sem conteúdo financeiro.
Nenhum desses fluxos registra valores, descrições ou o backup em log.

## CSV de lançamentos

Uma linha por lançamento (incluindo arquivados, marcados na coluna `arquivado`):
data, competência, descrição, valor exato em decimal com ponto, tipo, status,
conta, categoria, vencimento, pagamento, observações, origem, id e transferência.
Separador `;`, BOM UTF-8 e CRLF, como o CSV de relatórios.

Toda célula passa por `csvCell` (`packages/shared/src/metrics.ts`), compartilhado
com o CSV de métricas: texto que começa com `=`, `+`, `-`, `@`, tabulação, CR,
espaços seguidos desses sinais ou suas formas de largura total (`＝＋－＠`)
recebe um apóstrofo inicial. Números decimais puros, como `-12.34`, permanecem
numéricos. Aspas, `;` e quebras de linha são citados.

## Backup completo

Formato `ecofinance-user-backup`, versão `1`:

```
{ format, version, ownerId, createdAt, collections: {…}, summary: {counts, entries}, sha256 }
```

Inclui, em ordem referencial: contas, categorias, cartões, faturas, compras
parceladas e parcelas, recorrências e ocorrências, orçamentos e limites por
categoria, meses de planejamento (fechamento), preferências, lançamentos
(transferências, estornos, conciliações, vínculos de fatura/parcela/ocorrência e
de importação), lotes e linhas de importação, e metadados legados de viagens
(ainda referenciados por lançamentos antigos; a retirada é da #15).

Não inclui: logs de idempotência (`operations`), auditorias de migração,
credenciais e sessões, nem o arquivo original de importação (`payload`), que é
temporário. As preferências de exibição da web (tema, cards do painel, categoria
favorita) ficam no `localStorage` do navegador, não no servidor, e por isso não
entram no backup; a coleção `preferences` do servidor entra. Datas são codificadas como `{"$date": ISO-8601}`. O `summary` traz
contagens, total de lançamentos, arquivados e soma exata dos lançamentos ativos;
`sha256` cobre todo o corpo. A leitura é feita em uma única transação, então o
backup é um retrato consistente.

`sha256` detecta corrupção, não autentica o arquivo: o servidor revalida tudo na
restauração e nunca confia no conteúdo.

## Restauração

1. **Prévia** — O servidor confere formato, versão, `sha256`, `summary`,
   identidades únicas e proprietário único. Em seguida executa a restauração
   completa dentro de uma transação Firestore que é sempre revertida: cada documento
   passa por `validateDocument`, unicidade e verificação de referência de mesmo
   proprietário. A resposta mostra contagens do backup e atuais, totais, se o
   backup é de outra conta e `currentRevision`, um hash das revisões de todos os
   registros atuais.
2. **Confirmação** — O usuário marca que os dados atuais serão substituídos (e,
   se for de outra conta, que quer adotar os dados). O cliente envia
   `confirm: "RESTAURAR"`, `Idempotency-Key` e `If-Match: "<currentRevision>"`.
   Se algo mudou depois da prévia, a resposta é `409 REVISION_CONFLICT`. Repetir
   a mesma chave devolve o mesmo resultado sem nova escrita.
3. **Substituição atômica** — Em uma transação: lê todos os registros atuais,
   confere a revisão, apaga o grafo do proprietário (liberando os claims de
   unicidade) e grava o backup em ordem de dependência. Os lançamentos são
   ordenados topologicamente por estorno e conciliação. O ciclo
   ocorrência↔lançamento é gravado em duas etapas na mesma transação. Qualquer
   falha (validação, vínculo cruzado, identidade de outro dono, queda do processo,
   timeout) aborta a transação, e nada é gravado.

**Proprietário.** Backup do mesmo dono mantém as identidades. Backup de outra
conta é recusado (`409 FOREIGN_BACKUP`) sem `ownerMode: "adopt"`, que é o
fluxo autorizado para instalação nova ou migração de conta. Na adoção, cada
registro recebe uma identidade determinística nova (`stableId(['restore', dono,
id])`), aplicada também a todas as referências. As identidades que o app deriva
do dono são recalculadas quando o id original confere com a receita: mês de
planejamento, orçamento, limite, fatura, ocorrência, linha importada e
lançamento importado. Assim, fechamento de mês, geração de recorrências e
detecção de duplicatas de importação continuam funcionando. Textos livres
(descrição, notas, nomes, avisos) nunca são reescritos.

**Lotes sem original.** Como o arquivo bruto não entra no backup, lotes
restaurados em `received`/`processing` passam a `failed` com orientação para
reenviar o arquivo. Lotes em revisão continuam revisáveis, porque as linhas
extraídas estão no backup.

**Limites.** A restauração é uma única transação Firestore (requisição de até
10 MiB, até 270 s). Por isso o app aceita backups de até **3000 registros** e
**6 MiB** (`DATA_LIMITS`), recusados antes de qualquer leitura com
`413 BACKUP_TOO_LARGE`. Leituras de documentos e claims são carregadas em lote
(`DocumentStore.prefetch`) e repetidas dentro da transação são servidas do
retrato já lido. No emulador, 1500 lançamentos extras restauram em poucos
segundos. Acima do limite, a exportação continua disponível e a recuperação usa o
[backup operacional](firebase-migration.md) (`pnpm db:firebase backup/restore`,
`pnpm db:snapshot`, `pnpm db:verify-recovery`), ensaiado na CI.

Erros: `422 INVALID_BACKUP` (formato, integridade, proprietários misturados,
totais, invariantes ou vínculos), `422 UNSUPPORTED_BACKUP_VERSION`,
`400 CONFIRMATION_REQUIRED`, `409 FOREIGN_BACKUP`, `409 REVISION_CONFLICT`,
`413 BACKUP_TOO_LARGE`/`BODY_TOO_LARGE`.

Uma nova versão do formato exige incrementar `USER_BACKUP_VERSION` e escrever
uma conversão explícita das versões anteriores. Uma versão desconhecida é
recusada sem tentativa de interpretação.

## Retenção de arquivos importados

O arquivo original de uma importação existe só para a análise. Ele é apagado na
confirmação ou no cancelamento (#8) e, em qualquer outro estado, após **7 dias**
desde o upload (`IMPORT_ORIGINAL_RETENTION_DAYS`, ou `expiresAt` quando
definido). Falhas de leitura, OCR ou IA não estendem o prazo. Ao expirar:

- lote em revisão perde só o arquivo, e as linhas extraídas continuam
  confirmáveis;
- lote recebido, processando ou com falha passa a `failed`, com mensagem para
  reenviar; uma análise atrasada não consegue ressuscitá-lo, porque perde o
  token de processamento;
- lançamentos confirmados nunca dependem do original.

A varredura (`expireImportOriginals`) é idempotente. Ela roda para o próprio
usuário ao abrir `/settings` (`GET /api/data`) e o histórico de importações
(`GET /api/imports`). Para varrer todos os usuários, o operador roda
`pnpm db:firebase expire-originals` (agendável). A política aparece em
Configurações, com a lista de originais retidos, a data de exclusão de cada um e
o botão **Apagar original**, que usa `If-Match` e `Idempotency-Key` e não altera
linhas nem lançamentos.

## Exclusão

Exige o escopo, a frase digitada exatamente e `If-Match` com a revisão de
`GET /api/data`:

| Escopo | Frase | Remove |
|---|---|---|
| `data` | `EXCLUIR MEUS DADOS` | Todo o grafo financeiro do backup, auditorias de migração e logs de idempotência; o login continua |
| `account` | `EXCLUIR MINHA CONTA` | O mesmo, mais usuário, credenciais e sessões (o e-mail fica livre para novo provisionamento) |

Os logs de idempotência são apagados primeiro, em lotes, porque podem ser
numerosos e não carregam conteúdo financeiro. O grafo financeiro, e no escopo de
conta o login e as sessões, são apagados em uma única transação, liberando os
claims de unicidade. `DocumentStore.erase` só apaga dentro de transação explícita
e só registros do próprio dono, ou a identidade e a autenticação dele.
Repetir após o sucesso encontra a conta vazia e responde sucesso. Outras contas
nunca são lidas nem alteradas. Como as contas são provisionadas pelo operador
(`pnpm auth:user`), a reabertura após excluir a conta passa por ele.

## Validação

- `packages/db/tests/data.firebase.test.ts` (emulador):
  - round-trip para instalação vazia sob outro dono, com totais por mês, saldos,
    transferências, estornos, faturas e parcelas, ocorrências, linhas importadas,
    mês fechado e geração idempotente preservados;
  - restauração do mesmo dono após mudanças, com conflito de revisão e replay
    idempotente;
  - recusa de backups adulterados, de versão incompatível, com proprietários
    misturados, identidade de outro dono, vínculo cruzado ou invariante violada,
    sem alterar nenhum dado;
  - restauração interrompida no início, no meio e na etapa final sem estado
    parcial;
  - volume de 1500 lançamentos extras;
  - expiração e descarte de originais, isolada por dono;
  - exclusão com confirmação, revisão e isolamento, e exclusão de conta liberando
    o e-mail;
  - CSV com fórmulas neutralizadas.
- `packages/shared/src/data-export.test.ts`: CSV, rótulos e schemas.
- `tests/e2e/data.spec.ts` (Chromium, WebKit, Pixel 7):
  - exportar CSV e backup em `/settings`, alterar dados e restaurar pela prévia;
  - acesso anônimo, origem hostil, backup adulterado, revisão antiga, backup de
    outra conta recusado, exclusão com confirmação e restauração após exclusão.
