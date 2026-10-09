// Builds the synthetic document corpus (EF-10) in memory: digital PDFs written by
// pdf.ts, scans and photos rendered from them with pdf.js + @napi-rs/canvas, then
// rotated, blurred and encoded as JPEG/PNG/WebP. Every bank, store and value is
// fictitious. Expected results live in corpus.ts, written by hand.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { buildPdf, type PdfPage, type PdfText } from './pdf';

// Resolved from the working directory so the builder runs under Vitest (ESM) and Playwright (CJS).
const pdfjsDir = [join(process.cwd(), 'node_modules', 'pdfjs-dist'), join(process.cwd(), '..', '..', 'node_modules', 'pdfjs-dist')].find(dir => existsSync(dir))!;

const text = (x: number, y: number, value: string, size = 11, bold = false): PdfText => ({ x, y, text: value, size, bold });
type Row = [date: string, description: string, value: string, balance?: string];
interface Table { top: number; header: string[]; columns: number[]; rows: (Row | string)[] }
/** Table rows; a string row is a wrapped description line under the previous row. */
function table({ top, header, columns, rows }: Table): PdfText[] {
  const out = header.map((label, i) => text(columns[i]!, top, label, 11, true));
  rows.forEach((row, i) => {
    const y = top - 22 - i * 20;
    if (typeof row === 'string') out.push(text(columns[1]!, y, row, 10));
    else row.forEach((cell, c) => { if (cell) out.push(text(columns[c]!, y, cell)); });
  });
  return out;
}
const statementColumns = [40, 100, 380, 480];
const statementHeader = ['Data', 'Descrição', 'Valor (R$)', 'Saldo (R$)'];
function statementPages(): PdfPage[] {
  const head = [text(40, 790, 'Banco Exemplo S.A.', 16, true), text(40, 770, 'Extrato de conta corrente', 12), text(40, 752, 'Agência 0001  Conta 12345-6  Titular: Cliente Fictício'), text(40, 734, 'Período: 01/10/2026 a 31/10/2026')];
  return [
    { texts: [...head, ...table({ top: 700, header: statementHeader, columns: statementColumns, rows: [
      ['01/10', 'SALDO ANTERIOR', '', '1.000,00'],
      ['02/10', 'Supermercado Exemplo', '-123,45', '876,55'],
      ['05/10', 'Pix recebido Empresa Modelo', '350,00', '1.226,55'],
      ['07/10', 'Pagamento boleto Energia', '-210,30', '1.016,25'],
      'Distribuidora Fictícia ref. 10/2026',
      ['07/10', 'SALDO DO DIA', '', '1.016,25'],
    ] }), text(470, 40, 'Página 1 de 2', 9)] },
    { texts: [text(40, 790, 'Banco Exemplo S.A. — continuação', 12), ...table({ top: 750, header: statementHeader, columns: statementColumns, rows: [
      ['12/10', 'Farmácia Popular Exemplo', '-45,90', '970,35'],
      ['15/10', 'Salário Empresa Modelo', '3.500,00', '4.470,35'],
      ['20/10', 'Tarifa pacote de serviços', '-32,50', '4.437,85'],
      ['31/10', 'SALDO FINAL', '', '4.437,85'],
    ] }), text(470, 40, 'Página 2 de 2', 9)] },
  ];
}
function invoicePages(total: string): PdfPage[] {
  const columns = [40, 110, 430], header = ['Data', 'Lançamento', 'Valor (R$)'];
  const head = [text(40, 790, 'Cartão Exemplo Platinum', 16, true), text(40, 770, 'Fatura de outubro de 2026'), text(40, 752, 'Vencimento: 10/11/2026'), text(300, 752, 'Limite disponível: R$ 5.000,00')];
  return [
    { texts: [...head, ...table({ top: 710, header, columns, rows: [
      ['28/09', 'Pagamento recebido', '-980,00'], ['03/10', 'Restaurante Sabor Fictício', '89,90'],
      ['05/10', 'Posto Combustível Exemplo', '150,00'], ['08/10', 'Livraria Modelo', '59,90'],
    ] }), text(500, 40, '1/3', 9)] },
    { texts: [text(40, 790, 'Cartão Exemplo Platinum — lançamentos', 12), ...table({ top: 750, header, columns, rows: [
      ['12/10', 'Mercado Central Exemplo', '312,45'], ['15/10', 'Estorno Livraria Modelo', '-59,90'], ['18/10', 'Streaming Fictício', '39,90'],
    ] }), text(110, 660, 'Subtotal desta página'), text(430, 660, '292,45'), text(500, 40, '2/3', 9)] },
    { texts: [text(40, 790, 'Cartão Exemplo Platinum — lançamentos', 12), ...table({ top: 750, header, columns, rows: [
      ['22/10', 'Farmácia Exemplo', '75,30'], ['25/10', 'Loja Online Fictícia', '120,00'],
    ] }), text(110, 680, 'Total da fatura', 11, true), text(430, 680, total, 11, true), text(110, 660, 'Pagamento mínimo: R$ 118,13'), text(500, 40, '3/3', 9)] },
  ];
}
/** One-page statement used by the password, rotation and image fixtures. */
function shortStatement(): PdfPage {
  return { texts: [text(40, 790, 'Banco Exemplo S.A.', 18, true), text(40, 766, 'Extrato Conta Fácil', 14), text(40, 744, 'Período: 01/10/2026 a 31/10/2026', 13),
    text(40, 712, 'Saldo anterior', 13), text(400, 712, '500,00', 13),
    ...[['Data', 'Histórico', 'Valor (R$)'], ['03/10', 'Padaria Pão Quente', '-18,50'], ['09/10', 'Transferência recebida', '200,00'], ['16/10', 'Conta de água Saneamento', '-96,72'], ['27/10', 'Academia Movimento', '-89,90']]
      .flatMap((row, i) => row.map((cell, c) => text([40, 110, 400][c]!, 680 - i * 26, cell, 13, i === 0))),
    text(40, 530, 'Saldo final', 13), text(400, 530, '494,88', 13)] };
}
function receipt(): PdfPage {
  return { width: 420, height: 560, texts: [text(30, 520, 'Banco Exemplo', 18, true), text(30, 490, 'Comprovante de transferência Pix', 14),
    text(30, 450, 'Data: 14/10/2026 - 10:32', 13), text(30, 425, 'Valor: R$ 85,00', 13), text(30, 400, 'Destinatário: Padaria Exemplo Ltda', 13),
    text(30, 375, 'Instituição: Banco Fictício', 13), text(30, 350, 'Autenticação: 9F3A-21C7-55B0', 11)] };
}
async function render(pdf: Uint8Array, page: number, dpi: number): Promise<Canvas> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: pdf.slice(), standardFontDataUrl: join(pdfjsDir, 'standard_fonts').replaceAll('\\', '/') + '/', verbosity: 0 }).promise;
  const source = await document.getPage(page), viewport = source.getViewport({ scale: dpi / 72 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  await source.render({ canvasContext: context as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
  await document.loadingTask.destroy();
  return canvas;
}
/** Photo-like copy: rotated by `degrees` on a light grey background and blurred. */
function degrade(source: Canvas, degrees: number, blur: number): Canvas {
  const quarter = Math.abs(degrees) === 90;
  const canvas = createCanvas(quarter ? source.height : source.width, quarter ? source.width : source.height), context = canvas.getContext('2d');
  context.fillStyle = quarter ? '#fff' : '#eceae4'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(degrees * Math.PI / 180);
  if (blur) context.filter = `blur(${blur}px)`;
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}
function scanPdf(pages: Canvas[]): Uint8Array {
  return buildPdf(pages.map(page => ({ image: { jpeg: page.toBuffer('image/jpeg', 70), width: page.width, height: page.height } })));
}
const gif = () => Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b])]);
/** PNG whose header declares 10000×10000 pixels; nothing beyond the header exists. */
function pixelBomb() {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8); header.write('IHDR', 12, 'latin1'); header.writeUInt32BE(10000, 16); header.writeUInt32BE(10000, 20);
  header[24] = 8; header[25] = 2;
  return header;
}

export const DOCUMENT_PASSWORD = 'Senha-Ficticia-2026';
export async function buildDocumentCorpus() {
  const files = new Map<string, Uint8Array>();
  const write = (name: string, bytes: Uint8Array) => { files.set(name, new Uint8Array(bytes)); };
  const statement = buildPdf(statementPages()), invoice = buildPdf(invoicePages('787,55')), short = buildPdf([shortStatement()]);
  write('extrato-digital.pdf', statement);
  write('fatura-digital.pdf', invoice);
  write('fatura-total-divergente.pdf', buildPdf(invoicePages('800,00')));
  const missing = statementPages();
  missing[1]!.texts = missing[1]!.texts!.map(t => t.text === 'Página 2 de 2' ? { ...t, text: 'Página 3 de 3' } : t);
  missing[0]!.texts = missing[0]!.texts!.map(t => t.text === 'Página 1 de 2' ? { ...t, text: 'Página 1 de 3' } : t);
  write('extrato-pagina-ausente.pdf', buildPdf(missing));
  write('extrato-protegido.pdf', buildPdf([shortStatement()], { userPassword: DOCUMENT_PASSWORD }));
  write('extrato-rotacionado.pdf', buildPdf([{ ...shortStatement(), rotate: 90 }]));
  write('sem-movimentacoes.pdf', buildPdf([{ texts: [text(40, 790, 'Banco Exemplo S.A.', 16, true), text(40, 760, 'Comunicado de alteração de tarifas'), text(40, 740, 'A partir de 01/12/2026 o pacote de serviços passa a custar R$ 34,90 por mês.'), text(40, 720, 'Nenhuma ação é necessária.')] }]));
  write('pdf-truncado.pdf', statement.subarray(0, Math.floor(statement.length / 3)));
  write('pdf-21-paginas.pdf', buildPdf(Array.from({ length: 21 }, (_, i) => ({ texts: [text(40, 790, `Página ${i + 1}`)] }))));
  write('extrato-escaneado.pdf', scanPdf([await render(statement, 1, 150), await render(statement, 2, 150)]));
  write('comprovante-pix.png', (await render(buildPdf([receipt()]), 1, 150)).toBuffer('image/png'));
  const shortPage = await render(short, 1, 150);
  write('extrato-foto.jpeg', degrade(shortPage, 1.5, 0.6).toBuffer('image/jpeg', 85));
  write('extrato.webp', shortPage.toBuffer('image/webp', 90));
  write('extrato-girado.png', degrade(shortPage, 90, 0).toBuffer('image/png'));
  write('foto-ilegivel.jpeg', degrade(await render(short, 1, 50), 0, 4).toBuffer('image/jpeg', 40));
  write('imagem.gif', gif());
  write('bomba-de-pixels.png', pixelBomb());
  return files;
}
