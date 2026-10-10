import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Synthetic PDF and image corpus for #10, built in memory: no real person, bank
 * account or document appears here. Images are rendered by pdfjs from these PDFs
 * with its bundled fonts, so OCR results do not depend on the machine's fonts.
 */
export interface Cell { text: string; x: number; right?: boolean }
export type Row = Cell[] | string;
export interface PageSpec { rows: Row[]; width?: number; height?: number; size?: number; rotate?: 0 | 90 }
// Vitest loads this as ESM and Playwright as CommonJS; both run from the repository root.
const require = createRequire(path.join(process.cwd(), 'package.json'));
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const pdfjs = () => import(pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.mjs')).href);
const canvas = () => import(pathToFileURL(require.resolve('@napi-rs/canvas')).href);

function draw(page: PDFPage, font: PDFFont, spec: PageSpec) {
  const size = spec.size ?? 11, top = page.getHeight() - 40;
  spec.rows.forEach((row, index) => {
    const y = top - index * (size * 1.9);
    for (const cell of typeof row === 'string' ? [{ text: row, x: 40 }] : row) {
      const x = cell.right ? cell.x - font.widthOfTextAtSize(cell.text, size) : cell.x;
      page.drawText(cell.text, { x, y, size, font });
    }
  });
}
export async function textPdf(pages: PageSpec[]) {
  const document = await PDFDocument.create(), font = await document.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = document.addPage([spec.width ?? 595, spec.height ?? 842]);
    draw(page, font, spec);
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
  }
  return document.save({ useObjectStreams: false });
}
/** Render page 1 of a text PDF to a canvas on white paper; optionally turned clockwise. */
export async function render(pdf: Uint8Array, scale = 2, turn: 0 | 90 | 180 | 270 = 0) {
  const { getDocument } = await pdfjs(), { createCanvas } = await canvas();
  const task = getDocument({ data: pdf.slice(), standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts').replaceAll('\\', '/') + '/', isEvalSupported: false, disableFontFace: true, verbosity: 0 }), document = await task.promise;
  const page = await document.getPage(1), viewport = page.getViewport({ scale });
  const image = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height)), context = image.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, image.width, image.height);
  await page.render({ canvas: image as never, canvasContext: context as never, viewport }).promise;
  await task.destroy();
  if (!turn) return image;
  const swap = turn % 180 !== 0, out = createCanvas(swap ? image.height : image.width, swap ? image.width : image.height), g = out.getContext('2d');
  g.translate(out.width / 2, out.height / 2); g.rotate(turn * Math.PI / 180); g.drawImage(image, -image.width / 2, -image.height / 2);
  return out;
}
export async function picture(pages: PageSpec, format: 'png' | 'jpeg' | 'webp', options: { scale?: number; quality?: number; turn?: 0 | 90 | 180 | 270; blur?: number } = {}) {
  let image = await render(await textPdf([pages]), options.scale ?? 2, options.turn ?? 0);
  if (options.blur) {
    // Low resolution scan: shrink and enlarge again.
    const { createCanvas } = await canvas(), small = createCanvas(Math.max(1, Math.round(image.width / options.blur)), Math.max(1, Math.round(image.height / options.blur)));
    small.getContext('2d').drawImage(image, 0, 0, small.width, small.height);
    const big = createCanvas(image.width, image.height); big.getContext('2d').drawImage(small, 0, 0, big.width, big.height); image = big;
  }
  return new Uint8Array(format === 'png' ? await image.encode('png') : await image.encode(format, options.quality ?? 80));
}
/** Scanned PDF: each page is only an image of the text, without a text layer. */
export async function scannedPdf(pages: PageSpec[], turn: 0 | 90 = 0) {
  const document = await PDFDocument.create();
  for (const spec of pages) {
    const png = await document.embedPng(await picture(spec, 'png', { scale: 2, turn }));
    const width = spec.width ?? 595, height = spec.height ?? 842, [w, h] = turn ? [height, width] : [width, height];
    document.addPage([w, h]).drawImage(png, { x: 0, y: 0, width: w, height: h });
  }
  return document.save({ useObjectStreams: false });
}

// Standard security handler, revision 2 (40-bit RC4), written by hand: pdf-lib cannot encrypt.
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
function rc4(key: Uint8Array, data: Uint8Array) {
  const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; }
  const out = new Uint8Array(data.length); let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 255]!; }
  return out;
}
const md5 = (...parts: Uint8Array[]) => createHash('md5').update(Buffer.concat(parts)).digest();
// MD5/RC4 are what the PDF 1.4 security handler mandates; this only builds a test file.
const padded = (userKey: string) => Buffer.concat([Buffer.from(userKey, 'latin1'), PAD]).subarray(0, 32);
export function protectedPdf(lines: string[], userKey: string) {
  const id = md5(Buffer.from('ecofinance-synthetic')), permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const owner = rc4(md5(padded('owner-' + userKey)).subarray(0, 5), padded(userKey));
  const key = md5(padded(userKey), owner, permissions, id).subarray(0, 5), user = rc4(key, PAD);
  const objectKey = (n: number) => md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10);
  const escape = (text: string) => text.replace(/[\\()]/g, m => '\\' + m);
  const content = Buffer.from(`BT /F1 12 Tf 40 380 Td ${lines.map(line => `(${escape(line)}) Tj 0 -22 Td`).join(' ')} ET`, 'latin1');
  const stream = rc4(objectKey(4), content);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 420] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${Buffer.from(owner).toString('hex')}> /U <${Buffer.from(user).toString('hex')}> /P -4 >>`,
  ];
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')], offsets: number[] = [];
  const length = () => chunks.reduce((total, chunk) => total + chunk.length, 0);
  objects.forEach((body, index) => {
    offsets.push(length());
    if (body === null) chunks.push(Buffer.from(`${index + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n`, 'latin1'), Buffer.from(stream), Buffer.from('\nendstream\nendobj\n', 'latin1'));
    else chunks.push(Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1'));
  });
  const xref = length(), hex = id.toString('hex');
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${hex}> <${hex}>] >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

// Column positions shared by the synthetic invoices and statements.
const date = (text: string): Cell => ({ text, x: 40 }), describe = (text: string): Cell => ({ text, x: 110 });
const value = (text: string): Cell => ({ text, x: 430, right: true }), balance = (text: string): Cell => ({ text, x: 540, right: true });
export const invoicePages: PageSpec[] = [
  { rows: [
    'BANCO EXEMPLO S.A. - FATURA DO CARTAO DE CREDITO', 'Cliente: Pessoa Exemplo - cartao final 0000',
    [{ text: 'Vencimento: 10/10/2026', x: 40 }, { text: 'Total desta fatura: R$ 1.597,91', x: 300 }],
    [date('Data'), describe('Descricao'), value('Valor (R$)')],
    [date('28/12'), describe('LOJA EXEMPLO PARC 10/12'), value('89,90')],
    [date('05/09'), describe('PAGAMENTO EFETUADO'), value('-1.000,00')],
    [date('12/09'), describe('MERCADO BOM PRECO'), value('123,45')],
    [date('15/09'), describe('FARMACIA SAUDE'), value('1.234,56')],
    'Pagina 1 de 2',
  ] },
  { rows: [
    [date('Data'), describe('Descricao'), value('Valor (R$)')],
    [date('20/09'), describe('ESTORNO LOJA EXEMPLO'), value('-50,00')],
    [date('25/09'), describe('POSTO COMBUSTIVEL'), value('200,00')],
    [{ text: 'Total de lancamentos', x: 110 }, value('1.597,91')],
    'Pagina 2 de 2',
  ] },
];
export const invoiceRows = [
  ['-89.90', '2025-12-28', 'LOJA EXEMPLO PARC 10/12', 1], ['-123.45', '2026-09-12', 'MERCADO BOM PRECO', 1],
  ['-1234.56', '2026-09-15', 'FARMACIA SAUDE', 1], ['50.00', '2026-09-20', 'ESTORNO LOJA EXEMPLO', 2], ['-200.00', '2026-09-25', 'POSTO COMBUSTIVEL', 2],
];
export const statementPage: PageSpec = { rows: [
  'BANCO EXEMPLO - EXTRATO DE CONTA CORRENTE', 'Periodo: 01/10/2026 a 31/10/2026',
  [date('Data'), describe('Historico'), value('Valor'), balance('Saldo')],
  [date('01/10'), describe('SALDO ANTERIOR'), balance('1.000,00')],
  [date('02/10'), describe('PIX ENVIADO'), value('-150,00'), balance('850,00')],
  [describe('JOANA EXEMPLO')],
  [date('05/10'), describe('SALARIO EMPRESA EXEMPLO'), value('3.200,00'), balance('4.050,00')],
  [date('10/10'), describe('TARIFA PACOTE'), value('-35,90'), balance('4.014,10')],
  [date('15/10'), describe('PAGAMENTO BOLETO'), value('-1.234,56'), balance('2.779,54')],
  [date('31/10'), describe('SALDO FINAL'), balance('2.779,54')],
] };
export const statementRows = [
  ['-150.00', '2026-10-02', 'PIX ENVIADO JOANA EXEMPLO'], ['3200.00', '2026-10-05', 'SALARIO EMPRESA EXEMPLO'],
  ['-35.90', '2026-10-10', 'TARIFA PACOTE'], ['-1234.56', '2026-10-15', 'PAGAMENTO BOLETO'],
];
export const receiptPage: PageSpec = { width: 420, height: 420, size: 13, rows: [
  'COMPROVANTE DE PAGAMENTO', 'Pix enviado', 'Data: 03/10/2026 14:22', 'Favorecido: PADARIA EXEMPLO LTDA', 'CNPJ: 00.000.000/0001-00', 'Valor: R$ 27,50',
] };
export const scannedInvoicePage: PageSpec = { width: 595, height: 420, size: 13, rows: [
  'FATURA DO CARTAO DE CREDITO', 'Vencimento: 10/10/2026',
  [date('Data'), describe('Descricao'), value('Valor (R$)')],
  [date('12/09'), describe('MERCADO BOM PRECO'), value('123,45')],
  [date('15/09'), describe('FARMACIA SAUDE'), value('234,56')],
  [{ text: 'Total de lancamentos', x: 110 }, value('358,01')],
] };
