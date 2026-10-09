# Documentos: PDF, imagens e OCR (#10)

PDF digital, PDF escaneado e fotos PNG/JPEG/WebP entram no mesmo staging da #8
([importacoes.md](importacoes.md)) e chegam ao mesmo contrato de linhas dos formatos
estruturados da #9 ([formatos.md](formatos.md)). Nada é confirmado sem revisão. Cada
linha aponta para a página, a região e o trecho de onde veio. Valor ou data que não
puderam ser lidos ficam vazios, com aviso. O sistema nunca preenche um valor por
suposição.

## Fluxo

```text
POST /api/imports              upload (multipart limitado no stream) → lote "received"
POST /api/imports/{id}/process reivindica o lote ("processing", progresso "queued") e responde
   └─ fila em processo (import-jobs.ts) ─ worker_thread (workers/document-extract.mjs)
        pdf.js: texto + coordenadas por página
        página sem texto / imagem → @napi-rs/canvas → tesseract.js (por) → palavras + caixa + confiança
   └─ import-document.ts (TypeScript determinístico): linhas, tabela, sinais, anos, totais
   └─ mesmo stage da #8 → "review" (ou "failed" com diagnóstico)
GET  /api/imports/{id}         estado + progresso (fase, página/total), consultado a cada 1 s
POST /api/imports/{id}/cancel  cancela; o worker local é encerrado na hora
```

- **Fora do caminho síncrono.** A requisição só reivindica o lote e devolve
  `processing`. A extração roda em `worker_thread`, com heap limitado (384 MiB
  old-gen), sem bloquear o event loop do Next. O OCR roda em outra thread, aninhada,
  criada pelo tesseract.js.
- **Progresso** é gravado no próprio lote (`progress: {phase, page, pages}`), sem
  trocar a revisão. Assim, o `If-Match` do cancelamento continua válido durante a
  análise.
- **Cancelamento e substituição.** Cada checkpoint de progresso confere se o lote
  ainda está em `processing` com o mesmo `processId`. Se outra instância cancelou ou
  re-reivindicou o lote, o worker para sem gravar nada. Na mesma instância, cancelar
  encerra a thread imediatamente.
- **Timeout** de 120 s por documento (`IMPORT_DOCUMENT_TIMEOUT_MS`). O worker é
  encerrado e o lote falha com `TIMEOUT`.
- **Instância perdida.** O lote fica em "Processando" e "Repetir análise" o retoma.
  A nova reivindicação invalida a anterior.
- **Concorrência:** uma análise por instância (`IMPORT_DOCUMENT_CONCURRENCY`) e até
  oito na fila (`IMPORT_DOCUMENT_QUEUE`). Acima disso, a resposta é
  `503 DOCUMENT_QUEUE_FULL`, sem reivindicar o lote.

## Interpretação

Texto digital e OCR produzem o mesmo formato: palavras com posição na página. Daí
em diante, o caminho é único.

- **Linhas** são agrupadas por sobreposição vertical e ordenadas por x. Uma linha
  sem data nem valor, logo abaixo de uma transação e dentro do espaçamento da tabela,
  continua a descrição anterior (descrição quebrada).
- **Cabeçalho de tabela** (`Data` + `Descrição/Histórico/Lançamento` + `Valor`,
  `Débito/Crédito` ou `Saldo`) define as colunas pela posição x. Valores na coluna
  de saldo são ignorados. Débito vira negativo e crédito positivo. O cabeçalho
  repetido em cada página é contado e ignorado, então a tabela continua entre páginas.
- **Valores** exigem exatamente duas casas decimais (`-1.234,56`, `R$ 10,00`,
  `- R$ 5,00`, `10,00 D`, `(5,00)`). O separador decimal é o último antes dos
  centavos, e milhar inválido invalida o valor. A conversão usa os mesmos parsers
  exatos da #9, sem `parseFloat`.
- **Datas** aceitas: `DD/MM/AAAA`, `DD/MM`, `05 OUT` e `05/out`. Data sem ano
  recebe o ano do fim do período (extratos), do vencimento (faturas) ou da data
  completa mais recente do documento, com aviso. Meses posteriores à referência
  voltam um ano (dezembro numa fatura de janeiro). Sem nenhuma referência, a data
  fica vazia.
- **Linhas de resumo** (`Saldo anterior`, `Saldo do dia`, `Saldo final`, `Total`,
  `Subtotal`, `Pagamento mínimo`, `Limite`, `Transporte`) nunca viram gasto. Elas
  servem para conferir os totais.
- **Tipo de documento** é decidido pelo vocabulário: extrato, fatura de cartão ou
  comprovante.
  - Fatura: compras (positivas no documento) viram despesas, e créditos e estornos
    viram entradas. "Pagamento recebido" fica visível, com aviso de que não é compra
    nem estorno.
  - Comprovante: gera uma única linha a partir dos campos rotulados (`Valor`,
    `Data`, `Destinatário/Favorecido`). É saída, salvo "Pix recebido"/"recebimento".
  - Documento de conta enviado a um cartão (ou o contrário) recebe aviso de destino.
- **Exige revisão (avisos no lote e em cada linha):**
  - total declarado diferente da soma lida;
  - saldo anterior + movimentos ≠ saldo final;
  - "Página X de N" com páginas faltando ou fora da sequência;
  - página sem texto;
  - página girada (90°/180°/270°);
  - extrato sem nenhum sinal de débito/crédito;
  - linha com mais de um valor.
- **Legibilidade do OCR:** a confiança é a dos próprios dígitos ou da data.
  - Abaixo de 60%: o campo fica vazio e a linha, inválida.
  - De 60% a 79%: o campo é usado, com aviso.
  - Descrição abaixo de 80%: recebe aviso.
  - Documento sem linhas e com confiança abaixo de 60%: `LOW_LEGIBILITY`.
- **Sem movimentações:** `NO_ROWS`. Nenhum lote vazio vai para revisão.

### Origem por item

`ImportOrigin` ganhou `region` e `confidence`:

- `page`: página;
- `row`: linha visual na página;
- `excerpt`: linha original, com as continuações separadas por `⏎`;
- `region`: retângulo normalizado (0–1, a partir do canto superior esquerdo da
  página como exibida) que cobre data, descrição e valor;
- `confidence`: menor confiança do OCR entre as palavras usadas. Ausente em PDF
  digital.

A revisão mostra, por exemplo, "Origem: página 2 · linha 5 · região 7% da
esquerda, 41% do topo… · confiança do OCR 91%".

## PDF com senha

O primeiro processamento falha com `PASSWORD_REQUIRED` e `document.passwordRequired`.
A tela então pede a senha num campo `password` sem autocompletar, que é limpo após o
envio.

- A senha vai no corpo de `POST /process` (`{ "password": "…" }`), segue em memória
  até o `workerData` da thread e é descartada com ela.
- A senha não entra no lote, nas operações idempotentes, em logs, na assinatura de
  repetição do cliente nem nas mensagens de erro. A saída do worker é descartada
  porque bibliotecas poderiam ecoar conteúdo.
- Senha errada resulta em `PASSWORD_INCORRECT`. Arquivo estruturado com senha
  recebe `400 INVALID_INPUT`.
- Os testes Firebase e e2e procuram a senha em lotes, itens e operações gravados.

## Limites

| Limite | Valor | Onde |
| --- | --- | --- |
| Bytes por PDF/imagem | 512 KiB (estruturados seguem 256 KiB) | upload, `receiveImports`, cliente |
| Fotos maiores | reduzidas no navegador (lado maior 2400 px, JPEG, orientação EXIF aplicada) | `use-imports.ts` |
| Páginas | 20 | worker (`PAGE_LIMIT`) |
| Pixels declarados | 40 MP, lidos do cabeçalho PNG/JPEG/WebP antes de decodificar | `checkDocument` (`PIXEL_LIMIT`) |
| Pixels renderizados para OCR | 9 MP por página (300 DPI até A4) | worker |
| Palavras | 20 000 por documento | worker (`CONTENT_LIMIT`) |
| Linhas | 60 por lote (contrato da #8) | `ROW_LIMIT` |
| Tempo | 120 s por documento | `TIMEOUT` |
| Memória | 384 MiB de heap old-gen no worker | `MEMORY_LIMIT` |

O limite de 512 KiB mantém o original em base64 (≈ 683 KiB) dentro do documento
único do lote no Firestore. GIF, TIFF, BMP, HEIC/HEIF, AVIF e JPEG 2000 são
reconhecidos pela assinatura e recusados com a conversão necessária
(`UNSUPPORTED_FORMAT`).

## Degradação sem OCR

`IMPORT_OCR=on` habilita o OCR. Sem a variável, PDF digital funciona normalmente.

- Páginas sem texto viram aviso "OCR desativado neste servidor".
- Documento que só tem páginas sem texto falha com `OCR_UNAVAILABLE` e orienta a
  enviar o PDF original ou OFX/CSV.
- Fotos falham com `OCR_UNAVAILABLE`.

Nada depende de serviço pago ou de rede: os dados de idioma vêm do pacote npm
`@tesseract.js-data/por`, com cache desligado.

No Cloud Run padrão (512 MiB e CPU só durante requisições), o OCR fica desligado.
Veja [cloud-run.md](../deploy/cloud-run.md#pdf-imagens-e-ocr).

## Diagnósticos

| Código | Quando |
| --- | --- |
| `PASSWORD_REQUIRED`, `PASSWORD_INCORRECT` | PDF protegido sem senha ou com senha errada |
| `OCR_UNAVAILABLE` | sem camada de texto e OCR desligado, ou nada reconhecido |
| `LOW_LEGIBILITY` | nenhuma linha e confiança do OCR abaixo de 60% |
| `NO_ROWS` | documento lido, sem transação com data e valor |
| `CORRUPT_FILE` | PDF truncado ou corrompido, cabeçalho de imagem inválido |
| `UNSUPPORTED_FORMAT` | GIF, TIFF, BMP, HEIC, AVIF, JPEG 2000 |
| `FILE_LIMIT`, `PAGE_LIMIT`, `PIXEL_LIMIT`, `CONTENT_LIMIT`, `ROW_LIMIT` | limites acima |
| `TIMEOUT`, `MEMORY_LIMIT`, `EXTRACTION_FAILED` | worker interrompido |
| `DOCUMENT_QUEUE_FULL`, `DOCUMENTS_UNAVAILABLE` | fila cheia ou worker ausente na instalação (503) |

## ADR — bibliotecas de PDF e OCR

**Contexto.** O plano pede três coisas:

- texto com coordenadas em PDF digital;
- renderização e OCR local para scans e fotos;
- nenhum serviço pago obrigatório.

A imagem de produção é `node:22-bookworm-slim`, sem toolchain nativo
([nota do deploy](../deploy/cloud-run.md#imagem)). O repositório é MIT.

| Opção | Licença | Manutenção | Dependência de sistema | Decisão |
| --- | --- | --- | --- | --- |
| **pdfjs-dist 6.3.289** (Mozilla) | Apache-2.0 | release mensal (6.0 → 6.4 entre 05 e 10/2026) | nenhuma | **adotado**: texto com transformações, senha RC4/AES, renderização, `enableXfa: false`, `maxImageSize`; a v6 não tem caminho de `eval` |
| unpdf 1.8.1 | MIT | ativo | nenhuma | descartado: empacota o mesmo pdf.js, uma camada a mais |
| pdf-parse | MIT | v1 parada desde 2019; v2 encapsula pdf.js | nenhuma | descartado: sem coordenadas na API |
| mupdf.js | AGPL-3.0 | ativo | WASM | descartado: licença incompatível com distribuição MIT |
| **@napi-rs/canvas 1.0.9** | MIT | releases semanais | binário pré-compilado (Skia), sem toolchain | **adotado**: renderização do pdf.js em Node e decodificação PNG/JPEG/WebP |
| canvas (node-canvas) | MIT | ativo | cairo/pango do sistema | descartado: exige pacotes de sistema na imagem slim |
| **tesseract.js 7.0.0** + `@tesseract.js-data/por` 1.0.0 (`4.0.0_best_int`) | Apache-2.0 / MIT (dados tessdata Apache-2.0) | 7.0.0 em 12/2025; dados estáveis | WebAssembly, nenhuma | **adotado**: local, sem rede, roda em Windows/Linux/CI |
| tesseract CLI nativo | Apache-2.0 | ativo | `apt` na imagem + `child_process` | descartado por ora: mais rápido, mas muda a imagem e o desenvolvimento local |
| APIs pagas (Vision, Textract) | comercial | — | rede, chave | excluído pelo requisito e pela privacidade |

Todas as versões têm mais de duas semanas. `pnpm security:audit` não acusa nada.
O `tesseract.js` traz `node-fetch@2`, usado só para `langPath` por URL. Como os dados
são lidos do disco, ele nunca é chamado.

**Benchmark.** Medido com `pnpm exec tsx tests/fixtures/documents/benchmark.ts` no
Node v24.16.0, Intel i5-10400F, 12 threads, Windows. Cada fixture roda num processo
novo, um worker por job, como em produção. O RSS do processo inclui o heap
WebAssembly do OCR; o processo Node vazio usa ~45 MiB.

| Fixture | KiB | Resultado | Tempo (ms) | RSS pico (MiB) |
| --- | --- | --- | --- | --- |
| `extrato-digital.pdf` | 3 | text+text | 655 | 125 |
| `fatura-digital.pdf` | 3 | text+text+text | 772 | 125 |
| `extrato-protegido.pdf` | 2 | text | 687 | 126 |
| `extrato-rotacionado.pdf` | 2 | text | 627 | 126 |
| `pdf-21-paginas.pdf` | 6 | PAGE_LIMIT | 701 | 121 |
| `extrato-escaneado.pdf` (2 páginas) | 102 | ocr+ocr | 8066 | 468 |
| `comprovante-pix.png` | 55 | ocr | 1822 | 232 |
| `extrato-foto.jpeg` (1,5° e desfoque) | 56 | ocr | 2116 | 230 |
| `extrato.webp` | 37 | ocr | 2533 | 229 |
| `extrato-girado.png` (90°) | 107 | ocr, 2 tentativas de rotação | 5044 | 246 |
| `foto-ilegivel.jpeg` | 4 | ocr → LOW_LEGIBILITY | 1973 | 179 |

Uma variação de DPI foi medida: renderizar o scan a 200 DPI cai para 4,7 s e
322 MiB, mas leu `1.226,55` como `1:226,55`. Os 300 DPI ficaram, limitados a 9 MP
por página. Por isso o OCR exige ~0,5 GiB livres por análise e fica desligado no
Cloud Run de 512 MiB.

**Consequências.**

- O worker é um `.mjs` carregado por caminho. `next.config.ts` inclui
  explicitamente no standalone o worker, o pdf.js, o canvas nativo da plataforma, o
  tesseract.js-core e os dados `por` (+~70 MiB na imagem). A CI executa o worker
  dentro do container a partir desses arquivos.
- Só português. Outros idiomas exigem outro pacote de dados e revisão do
  interpretador.
- A primeira análise de cada job paga ~0,6 s de carga do pdf.js e ~0,3 s de
  inicialização do OCR. Não há pool aquecido; isso é deliberado, para limitar a
  memória ociosa.

## Corpus sintético

`tests/fixtures/documents/build.ts` gera em memória 17 arquivos fictícios. Nada
binário é commitado e nenhum dado é real.

- `pdf.ts` escreve PDFs mínimos: texto Helvetica WinAnsi, imagem JPEG, `/Rotate` e
  criptografia padrão RC4-128 (R3).
- Os scans e fotos são renderizados desses PDFs pelo pdf.js e depois girados,
  desfocados e codificados em JPEG, PNG ou WebP.
- As expectativas estão em `corpus.ts`, escritas à mão: valores, datas, descrições,
  página, soma e avisos.

| Fixture | Cobre |
| --- | --- |
| `extrato-digital.pdf` | 2 páginas, cabeçalho repetido, saldo por linha, descrição quebrada, saldo anterior/do dia/final conferidos, datas sem ano |
| `fatura-digital.pdf` | 3 páginas, `1/3`, compras → despesas, estorno → crédito, pagamento anterior com aviso, subtotal, total conferido, vencimento como ano |
| `fatura-total-divergente.pdf` | total declarado R$ 800,00 contra R$ 787,55 lidos |
| `extrato-pagina-ausente.pdf` | "Página 1 de 3" e "Página 3 de 3" num arquivo de 2 páginas |
| `extrato-protegido.pdf` | senha exigida, senha errada e senha correta |
| `extrato-rotacionado.pdf` | `/Rotate 90`: texto lido e girado de volta |
| `extrato-escaneado.pdf` | 2 páginas só imagem (150 DPI, JPEG): OCR com a mesma saída do digital |
| `comprovante-pix.png` | comprovante: uma saída, campos rotulados |
| `extrato-foto.jpeg` | foto com rotação de 1,5° e desfoque leve |
| `extrato.webp` | WebP |
| `extrato-girado.png` | imagem a 90°, lida após girar 270° |
| `foto-ilegivel.jpeg` | desfoque forte: `LOW_LEGIBILITY`, nenhuma linha |
| `sem-movimentacoes.pdf` | comunicado sem transações: `NO_ROWS` |
| `pdf-truncado.pdf`, `pdf-21-paginas.pdf`, `imagem.gif`, `bomba-de-pixels.png` | `CORRUPT_FILE`, `PAGE_LIMIT`, `UNSUPPORTED_FORMAT`, `PIXEL_LIMIT` (10000×10000 declarados) |

## Evidência

- **Unitários** (`pnpm test`):
  - `import-document-corpus.test.ts` roda o worker real (pdf.js, canvas, tesseract)
    sobre todo o corpus. Cobre também senha, degradação sem OCR, timeout, parada por
    checkpoint e cancelamento na fila.
  - `import-document.test.ts` cobre os ramos do interpretador com tokens sintéticos.
  - `import-document-file.test.ts` cobre assinaturas, cabeçalhos e limites.
  - `import-document.ts` e `import-document-file.ts` entram no gate de cobertura por
    arquivo.
- **Firebase** (`import-documents.firebase.test.ts`):
  - os 11 documentos legíveis chegam à revisão com origem;
  - extrato digital e fatura confirmados, com soma exata no ledger;
  - os 6 inválidos falham sem linhas;
  - a senha não fica em lotes, itens ou operações;
  - cancelamento durante o OCR, reivindicação repetida e degradação sem OCR;
  - limite de 512 KiB.
- **E2E** (`tests/e2e/import-documents.spec.ts`, Chromium, WebKit e Pixel 7):
  - PDF digital, PDF escaneado e PNG até a revisão, com página, região e confiança;
  - confirmação do comprovante;
  - progresso e cancelamento durante o OCR;
  - senha errada e correta pela tela.
