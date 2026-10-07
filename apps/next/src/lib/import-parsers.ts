import { IMPORT_LIMITS, civilDateSchema, moneySchema, type ParsedImportRow, type ImportSource } from '@ecofinance/shared';
import { FinanceError } from './finance-operation';

export interface ImportFile { name: string; mime: string; bytes: Uint8Array }
export interface ParsedImport { format: string; source: ImportSource; accountHint: string | null; rows: ParsedImportRow[]; warnings: string[] }
export interface ImportParser { format: string; detect: (text: string, file: ImportFile) => boolean; parse: (text: string, file: ImportFile) => Omit<ParsedImport, 'format' | 'warnings'> }
export class ImportParseError extends FinanceError {
  constructor(code:string,message:string,public format='Não identificado') {super(code,422,message);}
}
const error = (code: string, message: string,format?:string): never => { throw new ImportParseError(code, message,format); };
function date(value: string) {
  const raw = value.trim(), match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const normalized = match ? `${match[3]}-${match[2]}-${match[1]}` : /^\d{8}(?:\d{6}(?:\.\d+)?(?:\[[^\]]+\])?)?$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
  return civilDateSchema.safeParse(normalized).success ? normalized : null;
}
function amount(value: string, localized = false) {
  let normalized = value.trim();
  if (localized && /^-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(normalized)) normalized = normalized.replace(/\./g, '').replace(',', '.');
  const parsed = moneySchema.safeParse(normalized);
  return parsed.success && !/^[-]?0\.00$/.test(parsed.data) ? parsed.data : null;
}
function tag(text: string, name: string) {
  return new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, 'i').exec(text)?.[1]?.trim() ?? '';
}
function ofx(text: string): Omit<ParsedImport, 'format' | 'warnings'> {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) error('UNSAFE_CONTENT', 'O arquivo contém entidades XML. Exporte outro OFX sem entidades externas.');
  if (!/<\/OFX>\s*$/i.test(text)) error('CORRUPT_FILE', 'OFX incompleto. Exporte novamente o extrato no banco.');
  if (tag(text, 'CURDEF') !== 'BRL') error('UNSUPPORTED_CURRENCY', 'Escolha um extrato com moeda BRL explícita.');
  const starts = [...text.matchAll(/<STMTTRN>/gi)];
  if (!starts.length) error('NO_ROWS', 'O extrato não contém movimentações. Confira o período exportado.');
  if (starts.length > IMPORT_LIMITS.rows) error('ROW_LIMIT', `Exporte até ${IMPORT_LIMITS.rows} movimentações por arquivo para confirmação atômica.`);
  const namespace = `${tag(text, 'BANKID')}:${tag(text, 'ACCTID')}`;
  if(tag(text,'BANKID').length>100 || tag(text,'ACCTID').length>200)error('FIELD_LIMIT','A identificação bancária excede o limite. Exporte novamente um extrato válido.');
  const rows = starts.map((match, index): ParsedImportRow => {
    const start = match.index!, end = text.toUpperCase().indexOf('</STMTTRN>', start);
    if (end < 0 || end > (starts[index + 1]?.index ?? text.length)) error('CORRUPT_FILE', 'OFX contém blocos de movimentação incompletos. Exporte novamente.');
    const block = text.slice(start, end), value = amount(tag(block, 'TRNAMT')), day = date(tag(block, 'DTPOSTED'));
    const description = tag(block, 'NAME') || tag(block, 'MEMO') || null, fitid = tag(block, 'FITID');
    if(fitid.length>200)error('FIELD_LIMIT','Um identificador FITID excede 200 caracteres. Exporte novamente o extrato para manter a identidade auditável.');
    return { amount: value, purchaseDate: day, description: description?.slice(0, 500) ?? null,
      externalId: fitid && fitid.length <= 200 ? `${namespace}:${fitid}` : null,
      provenance: { row: text.slice(0, start).split('\n').length, excerpt: block.slice(0, 500) },
      warnings: [...(!value ? ['Valor ausente, zero ou inválido.'] : []), ...(!day ? ['Data ausente ou inválida.'] : []), ...(!description ? ['Descrição ausente.'] : []), ...(!fitid ? ['Sem FITID: duplicidades serão revisadas por conteúdo.'] : []), ...(description && description.length > 500 ? ['Descrição reduzida a 500 caracteres; confira o original.'] : [])] };
  });
  return { source: 'ofx', accountHint: tag(text, 'ACCTID') || null, rows };
}
/** RFC-style quoting, including embedded separators/newlines and doubled quotes. */
export function delimitedRows(text: string, separator: string) {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { cell += c; if (c === '\n') line++; }
    } else if (c === '"' && !cell && !closed) quoted = true;
    else if (c === separator) { cells.push(cell); cell = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell); if (cells.some(value => value.trim())) rows.push({ cells, line: startLine });
      cells = []; cell = ''; closed = false; line++; startLine = line;
    } else {
      if (closed || c === '"') error('CORRUPT_FILE', `Aspas inválidas na linha ${line}. Exporte CSV/TSV novamente.`);
      cell += c;
    }
  }
  if (quoted) error('CORRUPT_FILE', `Campo com aspas incompletas na linha ${startLine}.`);
  cells.push(cell); if (cells.some(value => value.trim())) rows.push({ cells, line: startLine });
  return rows;
}
const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const columns = { date: ['data', 'date', 'purchase_date'], description: ['descricao', 'description', 'memo'], amount: ['valor', 'amount', 'value'] };
function cellColumn(index:number) {
  let column=index+1,label='';
  while(column>0) {label=String.fromCharCode(65+(column-1)%26)+label;column=Math.floor((column-1)/26);}
  return label;
}
function separator(text: string) { return [';', '\t', ','].find(s => { const header = new Set(text.split(/\r?\n/, 1)[0]!.split(s).map(normalize)); return Object.values(columns).every(names => names.some(name => header.has(name))); }); }
function csv(text: string): Omit<ParsedImport, 'format' | 'warnings'> {
  const sep = separator(text); if (!sep) error('MISSING_COLUMNS', 'Informe cabeçalho data, descrição e valor em CSV/TSV.');
  const records = delimitedRows(text, sep!); const header = records.shift()!.cells.map(normalize);
  const aliases = Object.entries(columns).map(([key,names]) => ({key,names:new Set(names)}));
  const indices = Object.fromEntries(aliases.map(({key, names}) => [key, header.findIndex(name => names.has(name))]));
  if (aliases.some(({names}) => header.filter(name => names.has(name)).length !== 1)) error('AMBIGUOUS_COLUMNS', 'O cabeçalho contém colunas financeiras repetidas. Mantenha uma data, descrição e valor.');
  if (!records.length) error('NO_ROWS', 'Arquivo sem movimentações. Confira o período exportado.');
  if (records.length > IMPORT_LIMITS.rows) error('ROW_LIMIT', `Divida o arquivo em até ${IMPORT_LIMITS.rows} linhas por arquivo.`);
  return { source: 'csv', accountHint: null, rows: records.map(({ cells, line }) => {
    const value = amount(cells[indices.amount!] ?? '', sep !== ','), day = date(cells[indices.date!] ?? ''), description = cells[indices.description!]?.trim() || null;
    return { amount: value, purchaseDate: day, description: description?.slice(0, 500) ?? null, externalId: null,
      provenance: { row: line, cell: `${cellColumn(indices.amount!)}${line}`, excerpt: cells.join(sep).slice(0, 500) },
      warnings: [...(!value ? ['Valor ausente, zero ou inválido. Use sinal negativo para despesas.'] : []), ...(!day ? ['Data inválida. Use YYYY-MM-DD ou DD/MM/YYYY.'] : []), ...(!description ? ['Descrição ausente.'] : []), ...(description && description.length > 500 ? ['Descrição reduzida a 500 caracteres; confira o original.'] : []), ...(cells.length !== header.length ? ['Quantidade de colunas divergente; confira a linha.'] : [])] };
  }) };
}
export const importParsers: readonly ImportParser[] = [
  { format: 'OFX/QFX', detect: text => /<OFX>/i.test(text), parse: ofx },
  { format: 'CSV/TSV', detect: text => !!separator(text), parse: csv },
];
export function parseImport(file: ImportFile, parsers = importParsers): ParsedImport {
  if (!file.bytes.length) error('EMPTY_FILE', 'Arquivo vazio. Exporte novamente um período com movimentações.');
  if (file.bytes.length > IMPORT_LIMITS.bytes) error('FILE_LIMIT', 'Arquivo excede 256 KiB. Exporte um período menor.');
  const signature = Buffer.from(file.bytes.slice(0, 16));
  const pdf = signature.subarray(0, 4).toString() === '%PDF';
  const spreadsheet = signature.subarray(0, 2).toString() === 'PK' || signature.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1';
  let text = '', invalidEncoding = false;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes).replace(/^\uFEFF/, ''); }
  catch { invalidEncoding = true; }
  const binary = /\0/.test(text) || pdf || spreadsheet;
  if (binary) text = '';
  // Binary adapters receive the original bytes and can be registered without
  // changing this pipeline. Text adapters never inspect a binary container.
  const matching = parsers.filter(parser => parser.detect(text, file));
  if (!matching.length) {
    if (pdf) error('UNSUPPORTED_FORMAT', 'PDF requer o pipeline da issue 10. Exporte OFX/QFX ou CSV/TSV.', 'PDF');
    if (spreadsheet) error('UNSUPPORTED_FORMAT', 'Planilha binária ou protegida. Exporte CSV/TSV sem senha; XLS/XLSX será ampliado na issue 9.', 'XLS/XLSX ou ZIP');
    if (invalidEncoding) error('UNSUPPORTED_ENCODING', 'Exporte o arquivo em UTF-8 para preservar descrições.');
    if (binary) error('CORRUPT_FILE', 'Conteúdo binário incompatível. Exporte OFX/QFX ou CSV/TSV em UTF-8.');
  }
  if (matching.length !== 1) error('UNSUPPORTED_FORMAT', 'Conteúdo não reconhecido ou ambíguo. Confira o arquivo e exporte OFX/QFX ou CSV/TSV com data, descrição e valor.');
  const parser = matching[0]!;
  let parsed: Omit<ParsedImport,'format'|'warnings'>;
  try { parsed=parser.parse(text,file); }
  catch(cause) { if(cause instanceof ImportParseError)cause.format=parser.format; throw cause; }
  if(!parsed.rows.length || parsed.rows.length>IMPORT_LIMITS.rows)error('ROW_LIMIT',`O parser deve retornar entre 1 e ${IMPORT_LIMITS.rows} linhas. Exporte um período menor.`,parser.format);
  const expectedMime = parsed.source === 'ofx' ? ['application/x-ofx', 'application/vnd.intu.qfx', 'text/plain', 'application/octet-stream', ''] : ['text/csv', 'text/tab-separated-values', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream', ''];
  const warnings = expectedMime.includes(file.mime.toLowerCase().split(';')[0]!) ? [] : ['MIME diverge do conteúdo; formato identificado pela assinatura e pelas colunas.'];
  if (!/\.(ofx|qfx|csv|tsv)$/i.test(file.name)) warnings.push('Extensão não corresponde aos formatos usuais; confira o conteúdo identificado.');
  return { ...parsed, format: parser.format, warnings };
}
