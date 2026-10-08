import type { ImportMapping } from '../../../packages/shared/src/imports';
import { buildCorpus } from './build';

/**
 * Hand-written expectations for the synthetic corpus built in memory by build.ts.
 * Rows are [amount, purchaseDate, description, origin]; origin is the cell for
 * tabular formats and the line for OFX/QFX. `valid` counts rows with amount, date
 * and description; `total` is their exact sum. No real person or account appears here.
 */
export type CorpusRow = [amount: string | null, date: string | null, description: string | null, origin: string | number];
export interface CorpusCase {
  file: string; mime: string; family: 'OFX/QFX' | 'CSV/TSV' | 'XLS/XLSX';
  error?: string; mappingRequired?: string; mapping?: ImportMapping;
  format?: string; rows?: CorpusRow[]; valid?: number; total?: string; warnings?: string[]; externalId?: string;
}
let files: Map<string, Uint8Array> | undefined;
export function corpusBytes(file: string) {
  const bytes = (files ??= buildCorpus()).get(file);
  if (!bytes) throw new Error('Unknown corpus file ' + file);
  return bytes;
}
export const mapping = (patch: Partial<ImportMapping>): ImportMapping => ({ sheet: null, headerRow: 1, date: 0, description: 1, amount: 2, debit: null, credit: null, dateOrder: null, decimal: null, ...patch });
const sheet = (cell: string) => `'Extrato Out'!${cell}`;
const extrato: CorpusRow[] = [
  ['-45.90', '2026-10-01', 'Mercado Exemplo', sheet('C4')], ['-1234.56', '2026-10-02', 'Texto com valor', sheet('C5')],
  ['-33.33', '2026-10-03', 'Parcela calculada', sheet('C6')], ['-5.00', '2026-10-04', null, sheet('C7')],
  ['12.50', '2026-10-14', 'Data em texto', sheet('C8')], [null, '2026-10-05', 'Precisão excessiva', sheet('C9')],
];
export const corpus: CorpusCase[] = [
  { file: 'ofx-sgml-1252.ofx', mime: 'application/x-ofx', family: 'OFX/QFX', format: 'OFX SGML', valid: 4, total: '1445.26', warnings: ['Windows-1252'], externalId: '0341:12345-6:F001', rows: [
    ['-45.90', '2026-10-01', 'Padaria São João – Centro', 17], ['1500.00', '2026-10-05', 'Salário Empresa Fictícia', 24],
    ['-12.34', '2026-10-31', 'Tarifa & serviços', 31], ['3.50', '2026-10-15', 'Estorno Café · Lanchonete Modelo', 38]] },
  { file: 'ofx-xml-card.ofx', mime: 'application/x-ofx', family: 'OFX/QFX', format: 'OFX XML', valid: 3, total: '-309.90', externalId: ':4111XXXXXXXX1111:C1', rows: [
    ['-89.90', '2026-10-03', 'Livraria Exemplo & Cia', 6], ['-250.00', '2026-10-07', 'Loja Online Fictícia', 7], ['30.00', '2026-10-09', 'Crédito de estorno', 8]] },
  { file: 'quicken.qfx', mime: 'application/vnd.intu.qfx', family: 'OFX/QFX', format: 'QFX SGML', valid: 2, total: '-40.10', rows: [
    ['-10.00', '2026-10-02', 'Banca Fictícia', 17], ['-20.00', null, 'Data inválida', 24], ['-30.10', '2026-10-04', 'Sem identificador', 31]] },
  { file: 'ofx-hostile-entity.ofx', mime: 'application/x-ofx', family: 'OFX/QFX', error: 'UNSAFE_CONTENT' },
  { file: 'ofx-usd.ofx', mime: 'application/x-ofx', family: 'OFX/QFX', error: 'UNSUPPORTED_CURRENCY' },
  { file: 'ofx-two-accounts.ofx', mime: 'application/x-ofx', family: 'OFX/QFX', error: 'MULTIPLE_ACCOUNTS' },
  { file: 'ofx-truncated.ofx', mime: 'application/x-ofx', family: 'OFX/QFX', error: 'CORRUPT_FILE' },
  { file: 'csv-banco-1252.csv', mime: 'text/csv', family: 'CSV/TSV', format: 'CSV/TSV · ponto e vírgula · Windows-1252', valid: 3, total: '1257.94', warnings: ['Windows-1252', 'antes do cabeçalho'], rows: [
    [null, '2026-10-01', 'SALDO ANTERIOR', 'C5'], ['-1234.56', '2026-10-02', 'Supermercado Exemplo – Unidade 3', 'C6'],
    ['2500.00', '2026-10-15', 'Transferência recebida; ref. "abc"', 'C7'], ['-0.99', '2026-10-20', null, 'C8'], ['-7.50', '2026-10-31', 'Café “Modelo”', 'C9']] },
  { file: 'csv-utf8-bom-comma.csv', mime: 'text/csv', family: 'CSV/TSV', format: 'CSV/TSV · vírgula · UTF-8 com BOM', valid: 3, total: '-1228.56', rows: [
    ['-4.50', '2026-10-01', 'Coffee shop, downtown', 'C2'], ['-1234.56', '2026-10-02', 'Multi\nline note', 'C3'], ['10.50', '2026-10-03', 'Refund', 'C5']] },
  { file: 'tsv-utf16le.txt', mime: 'text/plain', family: 'CSV/TSV', format: 'CSV/TSV · tabulação · UTF-16 LE', valid: 2, total: '-1679.65', rows: [
    ['-1800.00', '2026-10-03', 'Aluguel Fictício', 'C2'], ['120.35', '2026-10-05', 'Reembolso Exemplo', 'D3'], [null, '2026-10-13', 'Lançamento duplo', 'C4']] },
  { file: 'csv-ambiguous-dates.csv', mime: 'text/csv', family: 'CSV/TSV', mappingRequired: 'Datas ambíguas', mapping: mapping({ dateOrder: 'dmy' }), valid: 3, total: '2969.50', rows: [
    ['-10.00', '2026-02-01', 'Mercado', 'C2'], ['-20.50', '2026-04-03', 'Farmácia', 'C3'], ['3000.00', '2026-06-05', 'Salário', 'C4']] },
  { file: 'csv-ambiguous-amounts.csv', mime: 'text/csv', family: 'CSV/TSV', mappingRequired: 'separador decimal', mapping: mapping({ decimal: ',' }), valid: 3, total: '-3724.00', rows: [
    ['-1234.00', '2026-10-01', 'Compra parcelada', 'C2'], ['-2500.00', '2026-10-02', 'Outra compra', 'C3'], ['10.00', '2026-10-03', 'Ajuste', 'C4']] },
  { file: 'csv-unknown-layout.txt', mime: 'text/plain', family: 'CSV/TSV', mappingRequired: 'Cabeçalho', mapping: mapping({ headerRow: 0 }), valid: 3, total: '118.55', rows: [
    ['-23.45', '2026-10-01', 'Corrida App Fictício', 'C1'], ['-8.00', '2026-10-02', 'Padaria Exemplo', 'C2'], ['150.00', '2026-10-03', 'Pix recebido', 'C3']] },
  { file: 'csv-misnamed.png', mime: 'image/png', family: 'CSV/TSV', valid: 1, total: '-1.00', warnings: ['MIME diverge', 'Extensão'], rows: [['-1.00', '2026-10-01', 'Arquivo renomeado', 'C2']] },
  { file: 'csv-broken-quotes.csv', mime: 'text/csv', family: 'CSV/TSV', error: 'CORRUPT_FILE' },
  { file: 'html-as-xls.xls', mime: 'application/vnd.ms-excel', family: 'XLS/XLSX', error: 'UNSUPPORTED_FORMAT' },
  { file: 'xlsx-multi-sheet.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'XLS/XLSX', format: 'XLSX · aba Extrato Out', valid: 4, total: '-1301.29', warnings: ['Abas ocultas', 'escolhida pelo cabeçalho'], rows: extrato },
  { file: 'xlsm-macro.xlsm', mime: 'application/vnd.ms-excel.sheet.macroEnabled.12', family: 'XLS/XLSX', format: 'XLSM · aba Extrato Out', valid: 4, total: '-1301.29', warnings: ['macros'], rows: extrato },
  { file: 'xlsx-two-statements.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'XLS/XLSX', mappingRequired: 'abas', mapping: mapping({ sheet: 'Cartão' }), format: 'XLSX · aba Cartão', valid: 2, total: '-21.50', rows: [
    ['-20.50', '2026-10-02', 'Compra cartão', "'Cartão'!C2"], ['-1.00', '2026-10-03', 'Outra compra cartão', "'Cartão'!C3"]] },
  { file: 'xls-biff8.xls', mime: 'application/vnd.ms-excel', family: 'XLS/XLSX', format: 'XLS · aba Extrato', valid: 3, total: '1849.24', rows: [
    ['-150.75', '2026-10-06', 'Conta de luz fictícia', 'Extrato!C2'], ['2000.00', '2026-10-07', 'Depósito', 'Extrato!C3'], ['-0.01', '2026-10-08', 'Taxa', 'Extrato!C4']] },
  { file: 'xls-filepass.xls', mime: 'application/vnd.ms-excel', family: 'XLS/XLSX', error: 'PROTECTED_FILE' },
  { file: 'xlsx-encrypted.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'XLS/XLSX', error: 'PROTECTED_FILE' },
  { file: 'xlsx-zip-bomb.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'XLS/XLSX', error: 'UNSAFE_CONTENT' },
  { file: 'xlsx-lying-size.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'XLS/XLSX', error: 'UNSAFE_CONTENT' },
];
