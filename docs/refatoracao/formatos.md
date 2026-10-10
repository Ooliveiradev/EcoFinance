# Formatos estruturados de importação (#9)

Parsers OFX/QFX, CSV/TSV e XLS/XLSX sobre o pipeline comum da #8
([importacoes.md](importacoes.md)): todos os formatos entram em staging, passam pela
mesma revisão linha a linha e só alteram saldos na confirmação explícita. Nenhum
formato descarta linhas em silêncio: linhas inválidas permanecem visíveis com avisos,
e linhas fora da revisão (preâmbulo antes do cabeçalho, abas ocultas) são
contadas nos avisos do lote.

## Matriz de suporte

| Formato | Variações aceitas | Recusado com orientação | Evidência por linha |
| --- | --- | --- | --- |
| OFX/QFX | OFX 1.x SGML (tags abertas), OFX 2.x XML, QFX (`INTU.BID`); conta corrente (`STMTRS`) e cartão (`CCSTMTRS`) | DOCTYPE/ENTITY/CDATA/comentários, moeda ≠ BRL, mais de uma conta no arquivo, arquivo truncado, bloco `STMTTRN` incompleto | linha do `<STMTTRN>` e trecho original |
| CSV/TSV | `;`, tab, `,`, `\|`; dica `sep=` do Excel; aspas RFC (separador, aspas duplicadas e quebra de linha dentro do campo); preâmbulo antes do cabeçalho; valor único com sinal ou colunas débito/crédito | aspas inválidas (com a linha), mais de 50 colunas, mais de 60 movimentações | célula do valor (`C7`) e linha bruta |
| XLSX/XLSM | várias abas, abas ocultas ignoradas, datas tipadas (formato de data), números, texto, fórmulas (valor salvo), macros ignoradas | senha/criptografia, XLSB, ODS, HTML renomeado para `.xls`, ZIP64, zip bomb, mais de 24 abas, 2.000 linhas ou 50 colunas | célula com aba (`'Extrato Out'!C6`) e valores da linha |
| XLS | BIFF8 (Excel 97–2003); BIFF5 com aviso de acentuação | `FILEPASS` (senha), documento OLE que não é planilha (Word/PowerPoint) | célula com aba (`Extrato!C2`) |

Codificações de texto: UTF-8, UTF-8 com BOM, UTF-16 LE/BE com BOM (exportação
"Texto Unicode" do Excel), Windows-1252 e ISO-8859-1. O nome da codificação aparece
no formato do lote (`CSV/TSV · ponto e vírgula · Windows-1252`). Bytes sem
correspondência em Windows-1252 (`0x81`, `0x8D`, `0x8F`, `0x90`, `0x9D`) e UTF-16
inválido são recusados como `UNSUPPORTED_ENCODING`.

PDF e imagens estão em [documentos.md](documentos.md) (#10). Não há promessa de compatibilidade universal: a matriz acima é
o que o corpus comprova.

## Detecção por conteúdo

A extensão e o MIME nunca escolhem o parser; divergências viram aviso no lote.

1. Vazio ou acima de 256 KiB → erro antes de qualquer leitura.
2. Assinatura binária: `%PDF`, PNG, JPEG ou WebP → leitor de documentos (#10); `PK\x03\x04` ou OLE
   (`D0 CF 11 E0`) → leitor de planilhas, que valida o contêiner e recusa ZIP/OLE que
   não sejam pastas de trabalho.
3. Texto decodificado (BOM, UTF-8 estrito, charset declarado no cabeçalho OFX/XML,
   fallback Windows-1252/Latin-1 explícito). NUL após decodificar é binário.
4. OFX quando o conteúdo começa com `OFXHEADER:`, `<?xml`/`<?OFX`/`<!` ou `<OFX>` e
   contém `<OFX>`.
5. CSV/TSV quando um separador produz colunas consistentes ou um cabeçalho reconhecido.
   HTML/XML de "planilha" recebe orientação específica.

O registro `importParsers` mantém o contrato `detect`/`parse` da #8; parsers recebem
o texto decodificado (vazio para binários), os bytes originais e o contexto
(codificação, mapeamento confirmado e perfis salvos).

## Datas e valores

Nada usa `parseFloat` nem `Date.parse`. Valores viram decimal exato validado por
`moneySchema`; datas viram data civil validada no calendário, sem fuso.

- OFX: `TRNAMT` aceita ponto (especificação) ou vírgula (alguns bancos brasileiros),
  sem separador de milhar; zeros finais extras são aceitos (`1.2500` → `1.25`), outras
  casas além de duas invalidam a linha. `DTPOSTED`/`DTUSER` aceitam
  `AAAAMMDD[HHMMSS[.XXX]][±H:TZ]`; horas inválidas invalidam a linha. Entidades XML
  (`&amp;`, `&#233;`) são decodificadas; DOCTYPE, ENTITY, CDATA e comentários XML são
  recusados, nunca removidos parcialmente.
- Texto (CSV e células de texto): `-1.234,56`, `1,234.56`, `R$ 10,00 D` (débito),
  `10,00 C`, `(5,00)`, `10,50-`, sinal de menos Unicode. Datas `AAAA-MM-DD`,
  `AAAAMMDD`, `DD/MM/AAAA`, `MM/DD/AAAA`, `01-Oct-26`, `1 de outubro de 2026`, com hora
  opcional ignorada. Ano com dois dígitos segue a janela do Excel (00–29 → 2000) e
  sempre gera aviso.
- Planilhas: células numéricas com formato de data viram data civil pelo número de
  série (respeitando `date1904`); números usam a representação decimal mais curta do
  valor armazenado — `0.333` ou `0.30000000000000004` invalidam a linha em vez de
  serem arredondados.

### Ambiguidade exige confirmação

A ordem dia/mês e o separador decimal são decididos **por arquivo**, pela evidência
dos próprios dados (`25/10` prova DD/MM; `10,50` prova vírgula decimal; `1.234.567`
prova ponto de milhar). Quando nenhum valor desambigua (`01/02/2026`, `1.234`) ou a
evidência conflita, a análise para com `MAPPING_REQUIRED` e o motivo; nada é
escolhido por padrão. O usuário confirma a ordem ou o separador no mapeamento.
Linhas individualmente inválidas para a regra escolhida continuam visíveis com aviso.

## Mapeamento assistido e perfis salvos

CSV/TSV e planilhas guardam no lote um `layout`: abas visíveis com dados, amostra de
até oito linhas, número de colunas, linha provável do cabeçalho, sugestão de
mapeamento e motivos. A tela mostra a amostra e permite escolher aba, linha do
cabeçalho (ou "sem cabeçalho"), colunas de data, descrição e valor (ou débito e
crédito), ordem das datas e separador decimal (`POST /api/imports/{id}/map`, com
`If-Match` e `Idempotency-Key`).

- Lote com falha é reanalisado no mesmo lote. Lote já em revisão é cancelado (linhas e
  origem preservadas) e substituído por um novo lote em revisão; nenhum saldo muda.
- Cabeçalhos reconhecidos dispensam mapeamento: aliases em português e inglês
  normalizados sem acento (`Data Lançamento`, `Histórico`, `Valor (R$)`, `Débito`,
  `Crédito`, `Amount`…). Colunas repetidas para o mesmo papel pedem escolha.
- **Perfil salvo:** com "Salvar mapeamento para este layout", o mapeamento fica no
  documento `preferences` do próprio usuário (`settings.importProfiles`), indexado
  pela impressão digital do layout — SHA-256 de aba, separador e cabeçalho
  normalizado (ou número de colunas, sem cabeçalho). Máximo de 50 perfis, os mais
  recentes. O próximo arquivo com o mesmo layout aplica o perfil e avisa; o perfil não
  dispensa uma confirmação que ele não contém (ex.: decimal salvo, datas ainda
  ambíguas). Não há coleção nova; o backup existente já inclui `preferences`.

## Planilhas: segurança

Antes de qualquer biblioteca ler um XLSX, `import-zip.ts` valida o contêiner sem
confiar nos cabeçalhos: sem ZIP64/multivolume, sem entrada criptografada, nomes
únicos, métodos store/deflate, no máximo 300 entradas, 8 MiB por entrada e 16 MiB no
total; cada entrada é descompactada com `maxOutputLength` igual ao tamanho declarado,
então tamanho mentido ou entradas sobrepostas são recusados como `UNSAFE_CONTENT`.
Contêiner OLE com `EncryptionInfo`/`EncryptedPackage` e XLS com `FILEPASS` são
`PROTECTED_FILE`. Fórmulas nunca são avaliadas (só o valor salvo, com aviso por
célula), macros (`vbaProject.bin`, `_VBA_PROJECT_CUR`) nunca são carregadas
(`bookVBA: false`) e descrições iniciadas por `=`, `+` ou `@` recebem aviso.

## ADR — biblioteca de planilhas

**Contexto.** O plano pede benchmark de corpus, licença, manutenção e limites. A
leitura roda só no servidor (rota Node), com arquivos de até 256 KiB.

**Benchmark** (Node 24, corpus sintético deste PR, sem a proteção ZIP do projeto):

| Arquivo | SheetJS CE 0.20.3 | ExcelJS 4.4.0 | read-excel-file 9.3.10 |
| --- | --- | --- | --- |
| `xlsx-multi-sheet.xlsx` | lê 3 abas, 16 ms | lê 3 abas, 52 ms | só 1ª aba, 25 ms |
| `xls-biff8.xls` | lê, 11 ms | não suporta XLS | não suporta XLS |
| `xlsx-encrypted.xlsx` / `xls-filepass.xls` | "File is password-protected" | erro genérico de ZIP | "legacy .xls" |
| `xlsx-zip-bomb.xlsx` (64 MiB declarados) | descompacta tudo, 136 ms | descompacta, 1 s e +148 MiB de heap | descompacta, 235 ms |
| `xlsx-lying-size.xlsx` | erro, 32 ms | descompacta e falha, 42 ms | erro, 15 ms |

| Critério | SheetJS CE 0.20.3 | ExcelJS 4.4.0 | read-excel-file 9.3.10 |
| --- | --- | --- | --- |
| Licença | Apache-2.0 | MIT | MIT |
| XLS (BIFF) | sim | não | não |
| Manutenção | versão atual do CDN oficial (07/2024); o pacote `xlsx` do npm parou em 0.18.5 | última versão 12/2024 | publicações frequentes (a mais recente, de 07/10/2026, não tem duas semanas) |
| Vulnerabilidades conhecidas | nenhuma para 0.20.3 (0.18.5 do npm tem GHSA-4r6h-8v6p-xvw6 e GHSA-5pgg-2g8v-p4x9) | `npm audit`: moderada via `uuid` | nenhuma no `npm audit` |
| Dependências | nenhuma | 9 diretas (jszip, unzipper, archiver…) | 4 diretas |

**Decisão.** SheetJS Community Edition 0.20.3, instalada do tarball oficial
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (método de instalação
documentado pelo projeto), em `apps/next`. É a única opção mantida que lê XLS e
XLSX, não tem dependências e identifica arquivos protegidos. Nenhuma biblioteca
avaliada limita a descompressão, por isso a proteção ZIP própria roda antes. A
biblioteca nunca recebe texto: CSV/HTML/SYLK não chegam ao SheetJS.

**Consequências.**
- O tarball vem do CDN da SheetJS, fora do registry npm. SHA-256
  `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`,
  SHA-512 (SRI) `oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`.
  O `pnpm-lock.yaml` gerado registra só a URL; fixar `integrity` no lockfile fica
  como pendência (ver abaixo).
- `pnpm security:audit` continua cobrindo o pacote pelo nome/versão.
- BIFF5 (Excel 95) sem tabela de codepages pode perder acentos; é aceito com aviso.

## Diagnósticos

| Código | Quando |
| --- | --- |
| `EMPTY_FILE`, `FILE_LIMIT`, `ROW_LIMIT`, `COLUMN_LIMIT`, `SHEET_LIMIT`, `FIELD_LIMIT` | limites de tamanho, linhas (60 movimentações; 2.000 linhas por aba), colunas, abas, identificadores |
| `UNSUPPORTED_ENCODING` | bytes que não são UTF-8/UTF-16/Windows-1252 |
| `UNSUPPORTED_FORMAT` | PDF, XLSB, ODS, HTML, ZIP/OLE sem planilha, texto sem colunas |
| `UNSUPPORTED_CURRENCY`, `MULTIPLE_ACCOUNTS` | OFX em outra moeda ou com várias contas |
| `CORRUPT_FILE` | truncado, aspas inválidas, ZIP/OLE corrompido |
| `UNSAFE_CONTENT` | DOCTYPE/ENTITY/CDATA/comentário XML, zip bomb, tamanho mentido, entradas repetidas/sobrepostas |
| `PROTECTED_FILE` | planilha com senha/criptografia |
| `MAPPING_REQUIRED` | layout desconhecido, colunas repetidas, datas/decimais ambíguos, aba a escolher |

Avisos por linha (sempre visíveis na revisão): valor/data/descrição ausente ou
inválida, data com ano de dois dígitos, débito e crédito na mesma linha, fórmula ou
erro na célula usada, colunas divergentes, provável linha de saldo/total, FITID
ausente ou repetido, tipo OFX com sinal incoerente, moeda estrangeira, descrição
truncada ou com caractere de fórmula.

## Corpus sintético

`tests/fixtures/imports/build.ts` monta em memória 24 arquivos fictícios (nenhum dado
real), com os bytes exatos de cada caso (CRLF, BOM, UTF-16, Windows-1252, ZIP/OLE).
Nada binário é commitado: a política `pnpm security:source` proíbe artefatos
`.ofx`/`.qfx` no repositório. As expectativas estão escritas à mão em
`tests/fixtures/imports/corpus.ts`, independentes do gerador: valores, datas,
descrições, célula/linha de origem, número de linhas válidas, soma exata e avisos do
lote. Os testes unitários, Firebase e e2e usam o mesmo corpus.

| Família | Arquivos |
| --- | --- |
| OFX/QFX | SGML Windows-1252 com entidade e vírgula decimal; XML de cartão com `ORIGCURRENCY`; QFX com data inexistente e sem FITID; DOCTYPE/ENTITY; USD; duas contas; truncado |
| CSV/TSV | banco Windows-1252 com preâmbulo, aspas e linha de saldo; UTF-8 BOM com vírgula e campo multilinha; UTF-16 LE com débito/crédito; datas ambíguas; valores ambíguos; layout sem cabeçalho com `\|`; CSV renomeado para `.png`; aspas quebradas; HTML renomeado para `.xls` |
| XLS/XLSX | três abas (resumo, extrato com preâmbulo, fórmula, data em texto, precisão excessiva, aba oculta); XLSM com macro fictícia; duas abas de extrato; XLS BIFF8; XLS com `FILEPASS`; XLSX criptografado; zip bomb; tamanho mentido |

## Evidência

- Unitários (`pnpm test`): corpus completo, inclusive o mesmo arquivo com nome e MIME
  genéricos, perfil salvo, valores/datas, codificações, contêiner ZIP, limites de
  planilha e contrato de mapeamento. Cobertura por arquivo no gate do
  `vitest.config.ts` para todos os módulos `import-*.ts` e `packages/shared`.
- Firebase (`pnpm test:firebase`, `import-formats.firebase.test.ts`): os dez arquivos
  reconhecidos diretamente chegam à revisão com valores e origem esperados, cinco
  deles são confirmados e conferem quantidade e soma exata de lançamentos; os dez
  hostis/corrompidos falham com diagnóstico, sem linhas; mapeamento assistido com
  perfil salvo e reaplicado; escolha de aba, substituição auditável de lote em
  revisão, idempotência e validação do mapeamento.
- E2E (`tests/e2e/import-formats.spec.ts`, Chromium, WebKit e Pixel 7): upload de
  OFX, CSV Windows-1252, TSV UTF-16, XLSX e XLS até a revisão com evidência por célula
  e confirmação de uma planilha; mapeamento de datas ambíguas e de aba pela tela,
  perfil reaplicado no upload seguinte, zip bomb e planilha protegida com diagnóstico.

## Estado e pendências

- Análises do mesmo usuário em paralelo disputam o lock das transações do Firestore
  (`ABORTED: Transaction lock timeout` no emulador com dez arquivos). A tela agora
  analisa os arquivos de um upload em sequência; a API continua aceitando chamadas
  paralelas, que falham com "Análise interrompida" e podem ser repetidas.
- Fixar `integrity` do tarball SheetJS no lockfile.
- Paridade no app Expo não faz parte desta issue.
