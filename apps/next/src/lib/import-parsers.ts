import { IMPORT_LIMITS, type ImportLayout, type ImportMapping, type ParsedImportRow, type ImportSource } from '@ecofinance/shared';
import { ImportParseError, parseError } from './import-errors';
import { decodeText } from './import-text';
import { detectOfx, parseOfx } from './import-ofx';
import { detectDelimiter, parseDelimited } from './import-delimited';
import { parseSpreadsheet, spreadsheetContainer } from './import-spreadsheet';

export { ImportParseError } from './import-errors';
export { delimitedRows } from './import-delimited';
export interface ImportFile { name: string; mime: string; bytes: Uint8Array }
export interface ParseOptions { mapping?: ImportMapping | null; profiles?: Record<string, ImportMapping>; parsers?: readonly ImportParser[] }
export interface ParseContext { encoding: string; mapping: ImportMapping | null; profiles: Record<string, ImportMapping> }
export interface ParsedContent { source: ImportSource; accountHint: string | null; rows: ParsedImportRow[]; format?: string; warnings?: string[]; layout?: ImportLayout; mapping?: ImportMapping }
export interface ParsedImport extends ParsedContent { format: string; warnings: string[] }
/** Parsers see decoded text (empty for binary containers) and always the original bytes. */
export interface ImportParser { format: string; detect: (text: string, file: ImportFile) => boolean; parse: (text: string, file: ImportFile, context: ParseContext) => ParsedContent }

const mimes: Record<ImportSource, string[]> = {
  ofx: ['application/x-ofx', 'application/ofx', 'application/vnd.intu.qfx', 'application/x-qfx', 'text/plain', 'text/xml', 'application/xml', 'application/octet-stream', ''],
  csv: ['text/csv', 'text/tab-separated-values', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream', ''],
  spreadsheet: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.ms-excel.sheet.macroenabled.12', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream', ''],
  document: [],
};
const extensions: Record<ImportSource, RegExp> = { ofx: /\.(ofx|qfx|txt|xml)$/i, csv: /\.(csv|tsv|txt)$/i, spreadsheet: /\.(xlsx|xlsm|xls)$/i, document: /\.pdf$/i };

export const importParsers: readonly ImportParser[] = [
  { format: 'OFX/QFX', detect: text => detectOfx(text), parse: text => parseOfx(text) },
  { format: 'CSV/TSV', detect: text => !!text && !detectOfx(text) && !/^\s*<(?:!doctype|html|\?xml|table)/i.test(text) && !!detectDelimiter(text), parse: (text, _file, context) => parseDelimited(text, context) },
  { format: 'XLS/XLSX', detect: (_text, file) => !!spreadsheetContainer(file.bytes), parse: (_text, file, context) => parseSpreadsheet(file.bytes, context) },
];
export function parseImport(file: ImportFile, options: ParseOptions = {}): ParsedImport {
  const parsers = options.parsers ?? importParsers;
  if (!file.bytes.length) parseError('EMPTY_FILE', 'Arquivo vazio. Exporte novamente um período com movimentações.');
  if (file.bytes.length > IMPORT_LIMITS.bytes) parseError('FILE_LIMIT', 'Arquivo excede 256 KiB. Exporte um período menor.');
  const pdf = Buffer.from(file.bytes.subarray(0, 4)).toString('latin1') === '%PDF', container = !!spreadsheetContainer(file.bytes);
  const decoded = pdf || container ? null : decodeText(file.bytes);
  // UTF-16 text legitimately contains NUL bytes before decoding; decoded NULs are binary.
  const binary = pdf || container || !decoded || decoded.text.includes('\0');
  const text = binary ? '' : decoded!.text;
  const matching = parsers.filter(parser => parser.detect(text, file));
  if (!matching.length) {
    if (pdf) parseError('UNSUPPORTED_FORMAT', 'PDF requer o pipeline da issue 10. Exporte OFX/QFX, CSV/TSV ou XLS/XLSX.', 'PDF');
    if (!decoded && !container) parseError('UNSUPPORTED_ENCODING', 'Codificação não reconhecida. Exporte o arquivo em UTF-8 ou Windows-1252.');
    if (binary) parseError('CORRUPT_FILE', 'Conteúdo binário incompatível. Exporte OFX/QFX, CSV/TSV ou XLS/XLSX.');
    if (/^\s*<(?:!doctype|html|table)/i.test(text)) parseError('UNSUPPORTED_FORMAT', 'Arquivo HTML com extensão de planilha. Abra no Excel e salve como XLSX ou exporte CSV.', 'HTML');
  }
  if (matching.length !== 1) parseError('UNSUPPORTED_FORMAT', 'Conteúdo não reconhecido ou ambíguo. Exporte OFX/QFX, CSV/TSV ou XLS/XLSX com data, descrição e valor.');
  const parser = matching[0]!;
  let parsed: ParsedContent;
  try { parsed = parser.parse(text, file, { encoding: decoded?.encoding ?? 'binário', mapping: options.mapping ?? null, profiles: options.profiles ?? {} }); }
  catch (cause) { if (cause instanceof ImportParseError && cause.format === 'Não identificado') cause.format = parser.format; throw cause; }
  const format = parsed.format ?? parser.format;
  if (!parsed.rows.length || parsed.rows.length > IMPORT_LIMITS.rows) parseError('ROW_LIMIT', `O parser deve retornar entre 1 e ${IMPORT_LIMITS.rows} linhas. Exporte um período menor.`, format);
  const warnings = [...(decoded?.warnings ?? []), ...(parsed.warnings ?? [])];
  if (!mimes[parsed.source].includes(file.mime.toLowerCase().split(';')[0]!.trim())) warnings.push('MIME diverge do conteúdo; formato identificado pela assinatura e pelas colunas.');
  if (!extensions[parsed.source].test(file.name)) warnings.push('Extensão não corresponde ao conteúdo; formato identificado pelo conteúdo.');
  return { ...parsed, format, warnings };
}
