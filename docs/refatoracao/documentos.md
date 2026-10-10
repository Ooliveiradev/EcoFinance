# PDF, digitalizações e fotos (#10)

Extratos, faturas de cartão e comprovantes em PDF digital, PDF escaneado e fotos
PNG/JPEG/WebP entram no mesmo pipeline da importação unificada
([importacoes.md](importacoes.md)): staging, revisão linha a linha e confirmação
explícita. O usuário não escolhe parser; a assinatura do arquivo decide. Nenhuma
linha é criada sem evidência e nenhum saldo muda antes da confirmação.

## Matriz de suporte

| Entrada | Leitura | Recusado com orientação |
| --- | --- | --- |
| PDF digital (camada de texto) | Texto e coordenadas por página (pdfjs) | Mais de 10 páginas, truncado (sem `%%EOF`), corrompido |
| PDF escaneado | Página renderizada sem camada de texto + OCR local | Idem; páginas acima do orçamento de pixels são reduzidas |
| PDF misto | Texto onde existe, OCR nas páginas sem texto | — |
| PDF protegido | Senha pedida na análise, nunca guardada | Senha ausente (`PASSWORD_REQUIRED`) ou incorreta (`PASSWORD_INVALID`) |
| PNG, JPEG, WebP | OCR local; transparência vira papel branco | Cabeçalho inválido/truncado, mais de 40 megapixels |
| GIF, TIFF, BMP, HEIC, AVIF, SVG | — | `UNSUPPORTED_FORMAT` com pedido de conversão para PNG/JPEG/WebP/PDF |

Arquivos continuam limitados a 256 KiB e 60 movimentações (a cópia em staging fica
no documento do lote no Firestore). Na web, fotos PNG/JPEG/WebP acima do limite são
redesenhadas na orientação correta (EXIF) e reduzidas para JPEG antes do envio; a
tela informa o tamanho original. O app Expo ainda envia o arquivo original.

## Pipeline

1. **Assinatura e cabeçalho**, no servidor principal e antes de qualquer
   decodificador: `%PDF-`, PNG, JPEG (FFD8FF), `RIFF…WEBP`. Dimensões vêm só do
   cabeçalho (IHDR, SOFn, VP8/VP8L/VP8X); o marcador de fim (`%%EOF`, `IEND`,
   `FFD9`, tamanho RIFF) é exigido, porque decodificadores desenham imagens
   truncadas pela metade.
2. **Extração em worker** (`apps/next/workers/document-worker.mjs`, `worker_threads`):
   heap limitado, tempo máximo de 45 s (abaixo do timeout de 60 s do Cloud Run) e
   **uma extração por processo**. A segunda espera até 10 s e depois recebe
   `DOCUMENT_BUSY` (503) com pedido de repetir, sem alterar nada. O worker devolve
   apenas palavras posicionadas: texto, caixa e confiança do OCR. A saída do worker
   é descartada sem log, porque avisos do pdfjs podem citar o documento.
3. **OCR local**: Tesseract (tesseract.js 7, modelo `por` LSTM `best_int` empacotado
   em `@tesseract.js-data/por`). Não há download em tempo de execução nem serviço
   externo. Uma leitura fraca (confiança < 70%) é repetida a 90°, 180° e 270°, e
   fica a de melhor pontuação. A rotação aplicada aparece nos avisos. O OCR só
   começa com 320 MiB livres no limite de memória do contêiner, e `IMPORT_OCR=off`
   o desliga; sem ele, páginas escaneadas e fotos terminam em `OCR_UNAVAILABLE`,
   enquanto PDFs com texto continuam funcionando
   ([operação no Cloud Run](../deploy/cloud-run.md#pdf-fotos-e-ocr)).
4. **Interpretação determinística** (`import-document-layout.ts`), em TypeScript puro
   e testável sem OCR: reconstrução de linhas, cabeçalhos de tabela, tipo de
   documento, valores, datas e conciliação de totais.

## Regras de interpretação

- **Linhas e tabelas.** Palavras são agrupadas por sobreposição vertical e ordenadas
  da esquerda para a direita. Trechos de texto do PDF com várias palavras são
  divididos com posição proporcional. Um cabeçalho com data e valor (ou débito,
  crédito, saldo), reconhecido pelos mesmos aliases dos parsers de tabela, define
  colunas por posição horizontal e vale até o próximo cabeçalho. Cabeçalhos
  repetidos em cada página são contados nos avisos.
- **Movimentação** é uma linha que começa com data (`12/09`, `12/09/2026`,
  `2026-09-12`, `12 SET`), tem descrição com letras e ao menos um valor com duas
  casas decimais. Uma linha seguinte sem data e sem valor, alinhada à descrição, é
  continuação da descrição. A evidência guarda as duas linhas.
- **Valor.** Com cabeçalho, vale a coluna de valor, débito ou crédito; a coluna de
  saldo é ignorada. Sem cabeçalho e com dois ou mais valores na linha, o valor fica
  vazio e a linha pede correção. Nunca se escolhe um dos valores.
- **Sinal.**
  - Fatura: compra sem sinal é despesa; `-` ou `C` é crédito/estorno.
  - Extrato: `-`, `D` e parênteses são saída; `+` e `C` são entrada. Valor sem sinal
    só é entrada quando o próprio extrato marca as saídas, e isso vira aviso; caso
    contrário fica pendente.
  - Coluna de débito/crédito define o sinal.
- **Datas.** Ordem DD/MM, a menos que o documento prove MM/DD; quando nenhuma data
  desambigua, há aviso. Data sem ano usa o vencimento da fatura ou a data completa
  mais recente do documento como referência: datas posteriores à referência caem no
  ano anterior (compra de dezembro numa fatura de janeiro), sempre com aviso. Sem
  referência, a data fica vazia.
- **Fora da revisão, sempre contados nos avisos com trecho e página:** saldo
  anterior/do dia/final, totais e subtotais, e pagamentos de fatura. O pagamento
  pertence ao fluxo de cartões e não é crédito novo.
- **Conferência.** Na fatura, a soma das linhas é comparada ao "total de
  lançamentos/compras" e, na falta dele, ao total da fatura. No extrato, compara-se
  saldo anterior + movimentações com o saldo final. Diferença, linha sem valor ou
  total ausente geram aviso explícito; nada é ajustado.
- **Comprovante** é o documento sem linhas de movimentação. Gera um único lançamento
  pelo valor rotulado (valor pago/total), pela primeira data completa e pelo
  favorecido/estabelecimento. É saída, salvo quando o documento indica recebimento.
  Itens do cupom não viram lançamentos.
- **Legibilidade.**
  - Página com OCR abaixo de 70% de confiança recebe aviso.
  - Valor, data ou descrição abaixo de 75% recebe aviso por campo.
  - Abaixo de 50%, o campo fica vazio para digitação.
  - Documento ilegível termina em `LOW_QUALITY`; documento sem movimentações, em
    `NO_ROWS`. Nunca há "sucesso" sem linhas.
- **Páginas ausentes.** "Página X de Y" diferente do número real de páginas gera
  aviso.
- **Destino.** Fatura enviada a uma conta, ou extrato enviado a um cartão, recebe
  aviso no lote.

Cada linha aponta para a página, o número da linha visual e a **região** (frações
0–1 da página na orientação lida), além do método (`text` ou `ocr`) e da confiança
média. O formato do lote informa método e tipo, por exemplo
`PDF escaneado (OCR) · fatura de cartão`.

## Senha, progresso e cancelamento

- `POST /api/imports/{id}/process` aceita `{ "password": "…" }` (1–128 caracteres).
  A senha vai apenas para o worker. Ela não é persistida no lote, nas linhas ou no
  registro de operações e não aparece em erros. O lote com falha guarda só
  `errorCode`, e a tela mostra o campo de senha.
- Durante a análise, o lote recebe `progress` (`page`, `pages`, `stage: text|ocr`)
  **sem mudar a revisão**, para que o cancelamento enviado com a revisão visível
  continue válido. A web consulta o lote a cada 1,5 s e mostra "Lendo página 2 de
  3 por leitura óptica (OCR)…".
- "Cancelar análise" marca o lote como cancelado. O servidor verifica o estado a
  cada página e a cada 2 s, e encerra o worker. Uma análise atrasada não ressuscita
  o lote (token de processamento da #8).

## Privacidade e custo

O OCR gratuito roda no próprio servidor (Cloud Run ou self-hosted), sem chave de
API. O texto do documento é tratado como dado: nada nele é executado ou
interpretado como instrução. O original fica em staging com a mesma retenção e
exclusão da #8. A imagem de produção ganha cerca de 120 MiB com pdfjs, a binding
canvas, o núcleo WASM do Tesseract e o modelo em português.

## ADR — bibliotecas

| Necessidade | Escolha | Licença | Motivo | Alternativas descartadas |
| --- | --- | --- | --- | --- |
| Texto, coordenadas e renderização de PDF | pdfjs-dist 6.3.289 (build legacy para Node) | Apache-2.0 | Mantido pela Mozilla, senha RC4/AES, JPEG 2000 via WASM, fontes e CMaps locais | pdf-parse (sem coordenadas, sem renderização), poppler (binário externo na imagem) |
| Canvas no Node | @napi-rs/canvas 1.0.9 | MIT | Binário pré-compilado (glibc/musl/Windows/macOS), recomendado pelo pdfjs | node-canvas (exige Cairo e toolchain na imagem) |
| OCR | tesseract.js 7.0.0 + `@tesseract.js-data/por` 1.0.0 | Apache-2.0 / Apache-2.0 (modelo) | WASM sem dependência nativa, roda offline, modelo empacotado no npm | Tesseract nativo (pacote do sistema), APIs pagas (violariam o requisito sem API paga) |

Versões fixadas; pdfjs na última versão com mais de duas semanas.

**Medições** (Node 24, Windows, corpus sintético deste PR):

| Caso | Tempo | Pico de memória do processo |
| --- | --- | --- |
| Fatura digital de 2 páginas | ~0,2 s | — |
| Foto JPEG de extrato (1786×2526) | 1,9 s | 225 MiB |
| PDF escaneado de 3 páginas A4 | 4,9 s | 282 MiB |

A base do processo de medição é de 35 MiB, e o Next standalone em repouso usa
~150 MiB. O serviço Cloud Run tem 512 MiB. Um OCR por instância, com a verificação
de folga de memória, cabe nesse orçamento. Se as recusas forem frequentes, subir
para 1 GiB é decisão de custo do mantenedor.

## Validação

- `import-document-layout.test.ts`: interpretação sem OCR.
  - Sinais D/C, parênteses, `+`/`-` e sinal ausente.
  - Colunas de débito/crédito/saldo e dois valores sem cabeçalho.
  - Confiança por campo, documento ilegível e documento sem movimentações.
  - Total de fatura igual, divergente, sem total e com linha vazia; saldo anterior
    e final.
  - Ano inferido e virada de ano, 29/02 inexistente, MM/DD provado e datas
    misturadas.
  - Pagamentos, subtotais, cabeçalhos repetidos, descrição em duas linhas,
    páginas ausentes, rotação, descrição com fórmula e limite de linhas.
  - Comprovantes de saída, de entrada e incompletos.
- `import-document.test.ts`: worker real.
  - Fatura digital multipágina, extrato com saldo, PDF escaneado e PDF girado 90°.
  - Comprovante PNG/WebP, extrato JPEG e foto borrada.
  - PDF protegido com senha ausente, errada e correta.
  - Limite de páginas, tempo e cancelamento, progresso e fila ocupada.
  - Assinaturas, dimensões, bombas de pixels, truncamento, formatos sem adaptador,
    worker que falha e instalação sem worker.
- `import-documents.firebase.test.ts`: emulador.
  - Staging e commit de fatura em cartão e aviso de destino.
  - Senha não persistida em lote, linhas ou operações.
  - Progresso sem mudar revisão e cancelamento que interrompe o OCR.
- `tests/e2e/import-documents.spec.ts`: navegador.
  - Fatura PDF com evidência de página, foto de comprovante e formulário de senha
    (errada e correta).
  - Ausência da senha nas respostas e layout sem rolagem horizontal.

Fixtures: `tests/fixtures/documents/build.ts`, gerados em memória, sem pessoas ou
contas reais. As imagens são renderizadas pelo pdfjs com fontes embutidas, então o
OCR não depende das fontes da máquina. O PDF protegido é cifrado à mão (RC4 de 40
bits, revisão 2), porque o pdf-lib não cifra.

## Limitações conhecidas

- **Formato e tamanho.**
  - Escrita à mão não é suportada.
  - Extratos com colunas intercaladas sem cabeçalho e tabelas em duas colunas de
    página pedem correção manual.
  - PDFs grandes precisam ser divididos (256 KiB, 10 páginas, 60 movimentações).
- **Datas.**
  - Fatura sem vencimento legível e sem data completa deixa datas sem ano para
    digitação.
  - Formatos de data além dos listados ficam pendentes.
- **Fotos.**
  - A orientação EXIF só é aplicada quando a web reduz a foto.
  - Fotos já dentro do limite seguem pela tentativa de rotações do OCR.
- **Mobile.** O app Expo envia PDF e imagens pelo seletor existente, mas ainda não
  mostra o campo de senha nem reduz fotos.
- **Fora do escopo.** A IA assistiva (#11) não participa: layout e campos vêm só de
  regras e OCR.
