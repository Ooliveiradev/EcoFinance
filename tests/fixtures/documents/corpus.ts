import { buildDocumentCorpus, DOCUMENT_PASSWORD } from './build';

/**
 * Hand-written expectations for the synthetic document corpus built by build.ts.
 * Rows are [amount, purchaseDate, description, page] after the sign rules of the
 * destination (card invoices: purchases negative, credits positive). `warnings`
 * are substrings that must appear in the batch warnings. OCR fixtures use clear
 * synthetic renders so the expected text is exact; the degraded photo must fail.
 */
export type DocumentRow = [amount: string | null, date: string | null, description: string | null, page: number];
export interface DocumentCase {
  file: string; mime: string; target: 'account' | 'card'; ocr: boolean;
  error?: string; password?: string; format?: string; kind?: string; rows?: DocumentRow[]; total?: string; warnings?: string[]; rotation?: number;
}
let files: Promise<Map<string, Uint8Array>> | undefined;
export async function documentBytes(file: string) {
  const bytes = (await (files ??= buildDocumentCorpus())).get(file);
  if (!bytes) throw new Error('Unknown document fixture ' + file);
  return bytes;
}
export { DOCUMENT_PASSWORD };
const statement: DocumentRow[] = [
  ['-123.45', '2026-10-02', 'Supermercado Exemplo', 1], ['350.00', '2026-10-05', 'Pix recebido Empresa Modelo', 1],
  ['-210.30', '2026-10-07', 'Pagamento boleto Energia Distribuidora Fictícia ref. 10/2026', 1],
  ['-45.90', '2026-10-12', 'Farmácia Popular Exemplo', 2], ['3500.00', '2026-10-15', 'Salário Empresa Modelo', 2], ['-32.50', '2026-10-20', 'Tarifa pacote de serviços', 2],
];
const invoice: DocumentRow[] = [
  ['980.00', '2026-09-28', 'Pagamento recebido', 1], ['-89.90', '2026-10-03', 'Restaurante Sabor Fictício', 1], ['-150.00', '2026-10-05', 'Posto Combustível Exemplo', 1],
  ['-59.90', '2026-10-08', 'Livraria Modelo', 1], ['-312.45', '2026-10-12', 'Mercado Central Exemplo', 2], ['59.90', '2026-10-15', 'Estorno Livraria Modelo', 2],
  ['-39.90', '2026-10-18', 'Streaming Fictício', 2], ['-75.30', '2026-10-22', 'Farmácia Exemplo', 3], ['-120.00', '2026-10-25', 'Loja Online Fictícia', 3],
];
const short: DocumentRow[] = [
  ['-18.50', '2026-10-03', 'Padaria Pão Quente', 1], ['200.00', '2026-10-09', 'Transferência recebida', 1],
  ['-96.72', '2026-10-16', 'Conta de água Saneamento', 1], ['-89.90', '2026-10-27', 'Academia Movimento', 1],
];
export const documentCorpus: DocumentCase[] = [
  { file: 'extrato-digital.pdf', mime: 'application/pdf', target: 'account', ocr: false, format: 'PDF digital · extrato', kind: 'statement', rows: statement, total: '3437.85', warnings: ['1 cabeçalho(s) de tabela repetido(s)', 'Datas sem ano completadas pelo período (31/10/2026)'] },
  { file: 'fatura-digital.pdf', mime: 'application/pdf', target: 'card', ocr: false, format: 'PDF digital · fatura de cartão', kind: 'invoice', rows: invoice, total: '192.45', warnings: ['2 cabeçalho(s) de tabela repetido(s)', 'pelo vencimento (10/11/2026)'] },
  { file: 'fatura-total-divergente.pdf', mime: 'application/pdf', target: 'card', ocr: false, format: 'PDF digital · fatura de cartão', kind: 'invoice', rows: invoice, total: '192.45', warnings: ['O total declarado (R$ 800,00) não confere com o calculado a partir das linhas lidas (R$ 787,55)'] },
  { file: 'extrato-pagina-ausente.pdf', mime: 'application/pdf', target: 'account', ocr: false, format: 'PDF digital · extrato', kind: 'statement', rows: statement, total: '3437.85', warnings: ['O documento indica 3 páginas, mas o arquivo tem 2'] },
  { file: 'extrato-protegido.pdf', mime: 'application/pdf', target: 'account', ocr: false, password: DOCUMENT_PASSWORD, format: 'PDF digital · extrato', kind: 'statement', rows: short, total: '-5.12' },
  { file: 'extrato-rotacionado.pdf', mime: 'application/pdf', target: 'account', ocr: false, format: 'PDF digital · extrato', kind: 'statement', rows: short, total: '-5.12', warnings: ['Página 1 lida após girar 90°'], rotation: 90 },
  { file: 'extrato-escaneado.pdf', mime: 'application/pdf', target: 'account', ocr: true, format: 'PDF escaneado (OCR) · extrato', kind: 'statement', rows: statement, total: '3437.85', warnings: ['1 cabeçalho(s) de tabela repetido(s)'] },
  { file: 'comprovante-pix.png', mime: 'image/png', target: 'account', ocr: true, format: 'Imagem PNG (OCR) · comprovante', kind: 'receipt', rows: [['-85.00', '2026-10-14', 'Padaria Exemplo Ltda', 1]], total: '-85.00' },
  { file: 'extrato-foto.jpeg', mime: 'image/jpeg', target: 'account', ocr: true, format: 'Imagem JPEG (OCR) · extrato', kind: 'statement', rows: short, total: '-5.12' },
  { file: 'extrato.webp', mime: 'image/webp', target: 'account', ocr: true, format: 'Imagem WebP (OCR) · extrato', kind: 'statement', rows: short, total: '-5.12' },
  { file: 'extrato-girado.png', mime: 'image/png', target: 'account', ocr: true, format: 'Imagem PNG (OCR) · extrato', kind: 'statement', rows: short, total: '-5.12', warnings: ['Página 1 lida após girar 270°'], rotation: 270 },
  { file: 'foto-ilegivel.jpeg', mime: 'image/jpeg', target: 'account', ocr: true, error: 'LOW_LEGIBILITY' },
  { file: 'sem-movimentacoes.pdf', mime: 'application/pdf', target: 'account', ocr: false, error: 'NO_ROWS' },
  { file: 'pdf-truncado.pdf', mime: 'application/pdf', target: 'account', ocr: false, error: 'CORRUPT_FILE' },
  { file: 'pdf-21-paginas.pdf', mime: 'application/pdf', target: 'account', ocr: false, error: 'PAGE_LIMIT' },
  { file: 'imagem.gif', mime: 'image/gif', target: 'account', ocr: false, error: 'UNSUPPORTED_FORMAT' },
  { file: 'bomba-de-pixels.png', mime: 'image/png', target: 'account', ocr: false, error: 'PIXEL_LIMIT' },
];
