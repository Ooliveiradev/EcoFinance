import * as XLSX from 'xlsx';
import { IMPORT_MAPPING_LIMITS, civilDateSchema, type ImportMapping } from '@ecofinance/shared';
import { parseError } from './import-errors';
import { interpretTable, layoutOf, preview, suggest, type Table, type TableCell } from './import-table';
import { cellColumn } from './import-values';
import { inspectZip } from './import-zip';

/**
 * XLS (BIFF/OLE) and XLSX/XLSM through SheetJS CE, after this module validates the
 * container. Only stored cell values are read: formulas are never evaluated,
 * macros are never loaded and encrypted workbooks are refused.
 */
const FORMAT = 'XLS/XLSX';
export const SPREADSHEET_LIMITS = { sheets: 24, rows: 2000 } as const;
type Context = { mapping: ImportMapping | null; profiles: Record<string, ImportMapping> };

export function spreadsheetContainer(bytes: Uint8Array) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip' as const;
  return Buffer.from(bytes.subarray(0, 8)).toString('hex') === 'd0cf11e0a1b11ae1' ? 'cfb' as const : null;
}
/** Identify the workbook kind and refuse protected or non-spreadsheet containers. */
function container(bytes: Uint8Array) {
  const warnings: string[] = [];
  if (spreadsheetContainer(bytes) === 'zip') {
    const names = inspectZip(bytes);
    if (names.includes('xl/workbook.bin')) parseError('UNSUPPORTED_FORMAT', 'Pasta binária XLSB não é aceita. Salve como XLSX ou exporte CSV.', 'XLSB');
    if (names.includes('mimetype') || names.includes('content.xml')) parseError('UNSUPPORTED_FORMAT', 'Planilha OpenDocument não é aceita. Salve como XLSX ou exporte CSV.', 'ODS');
    if (!names.includes('xl/workbook.xml')) parseError('UNSUPPORTED_FORMAT', 'O ZIP não contém uma planilha XLSX. Exporte OFX/QFX, CSV/TSV ou XLSX.', 'ZIP');
    const macro = names.includes('xl/vbaProject.bin');
    if (macro) warnings.push('A pasta contém macros; elas foram ignoradas e nunca são executadas.');
    return { kind: macro ? 'XLSM' : 'XLSX', warnings };
  }
  let names: string[] = [];
  try { names = (XLSX.CFB.read(Buffer.from(bytes), { type: 'buffer' }) as { FileIndex: { name: string }[] }).FileIndex.map(entry => entry.name); }
  catch { parseError('CORRUPT_FILE', 'Arquivo OLE/XLS corrompido. Salve a planilha novamente.', 'XLS'); }
  if (names.includes('EncryptionInfo') || names.includes('EncryptedPackage')) parseError('PROTECTED_FILE', 'Planilha protegida por senha. Remova a senha no Excel ou exporte CSV.', 'XLSX');
  if (!names.includes('Workbook') && !names.includes('Book')) parseError('UNSUPPORTED_FORMAT', 'Documento OLE sem planilha (por exemplo, Word ou PowerPoint). Exporte OFX/QFX, CSV/TSV ou XLS/XLSX.', 'OLE');
  if (names.includes('_VBA_PROJECT_CUR') || names.includes('VBA')) warnings.push('A pasta contém macros; elas foram ignoradas e nunca são executadas.');
  if (!names.includes('Workbook')) warnings.push('Formato Excel 5/95 (BIFF5): confira acentos e valores.');
  return { kind: 'XLS', warnings };
}
const quote = (name: string) => /^[A-Za-z_][\w.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
function convert(cell: XLSX.CellObject | undefined, date1904: boolean): TableCell {
  if (!cell || cell.t === 'z') return { text: '' };
  const formula = !!cell.f, base = { ...(formula ? { formula } : {}) };
  if (cell.t === 'n' && typeof cell.v === 'number') {
    if (cell.z && XLSX.SSF.is_date(cell.z)) {
      const parts = XLSX.SSF.parse_date_code(cell.v, { date1904 }) as { y: number; m: number; d: number } | null;
      const value = parts && `${String(parts.y).padStart(4, '0')}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
      return { ...base, text: cell.w ?? String(cell.v), date: value && civilDateSchema.safeParse(value).success ? value : null };
    }
    return { ...base, text: cell.w ?? String(cell.v), number: cell.v };
  }
  if (cell.t === 'b') return { ...base, text: cell.v ? 'VERDADEIRO' : 'FALSO' };
  if (cell.t === 'e') return { ...base, text: cell.w ?? '#ERRO', error: true };
  return { ...base, text: String(cell.v ?? cell.w ?? '') };
}
function table(name: string, sheet: XLSX.WorkSheet, date1904: boolean): Table {
  if (sheet['!fullref']) parseError('ROW_LIMIT', `A aba ${name.slice(0, 40)} excede ${SPREADSHEET_LIMITS.rows} linhas. Exporte um período menor.`, FORMAT);
  const rows: Table['rows'] = [], data = (sheet['!data'] ?? []) as (XLSX.CellObject | undefined)[][];
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const source = data[r] ?? [];
      if (source.slice(IMPORT_MAPPING_LIMITS.columns).some(cell => cell && cell.t !== 'z' && String(cell.v ?? '').trim())) parseError('COLUMN_LIMIT', `A aba ${name.slice(0, 40)} tem dados após a coluna ${cellColumn(IMPORT_MAPPING_LIMITS.columns - 1)}. Mantenha apenas as colunas do extrato.`, FORMAT);
      const cells = Array.from({ length: Math.min(range.e.c + 1, IMPORT_MAPPING_LIMITS.columns) }, (_, c) => convert(source[c], date1904));
      if (cells.some(cell => cell.text.trim() || cell.number !== undefined)) rows.push({ line: r + 1, cells });
    }
  }
  return { name, rows, separator: null, ref: (line, column) => `${quote(name)}!${cellColumn(column)}${line}` };
}
export function parseSpreadsheet(bytes: Uint8Array, context: Context) {
  const { kind, warnings } = container(bytes);
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, { type: 'buffer', dense: true, cellFormula: true, cellNF: true, cellHTML: false, cellText: true, cellDates: false, sheetRows: SPREADSHEET_LIMITS.rows + 1, bookVBA: false, WTF: false });
  } catch (cause) {
    if (/password|encrypt/i.test(String(cause))) parseError('PROTECTED_FILE', 'Planilha protegida por senha. Remova a senha no Excel ou exporte CSV.', kind);
    return parseError('CORRUPT_FILE', 'Não foi possível ler a planilha. Salve novamente como XLSX ou exporte CSV.', kind);
  }
  if (book.SheetNames.length > SPREADSHEET_LIMITS.sheets) parseError('SHEET_LIMIT', `A pasta tem mais de ${SPREADSHEET_LIMITS.sheets} abas. Copie o extrato para uma pasta menor.`, kind);
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  const hidden = book.SheetNames.filter((_, index) => book.Workbook?.Sheets?.[index]?.Hidden);
  const tables = book.SheetNames.filter(name => !hidden.includes(name)).map(name => table(name, book.Sheets[name]!, date1904)).filter(sheet => sheet.rows.length);
  if (hidden.length) warnings.push(`Abas ocultas ignoradas: ${hidden.join(', ').slice(0, 200)}.`);
  if (!tables.length) parseError('NO_ROWS', 'A planilha não tem células preenchidas em abas visíveis.', kind);
  const requested = context.mapping?.sheet ?? null;
  const chosen = requested !== null ? tables.find(sheet => sheet.name === requested)
    : tables.find(sheet => context.profiles[preview(sheet).fingerprint]) ?? (tables.length === 1 ? tables[0] : undefined);
  const recognized = tables.filter(sheet => !suggest(sheet, sheet.name).reasons.length);
  const selected = chosen ?? (requested === null && recognized.length === 1 ? recognized[0] : undefined);
  if (!selected) {
    const first = recognized[0] ?? tables[0]!, reason = requested !== null ? `A aba ${requested.slice(0, 40)} não existe ou está vazia. Escolha outra aba.` : `A pasta tem ${tables.length} abas com dados. Escolha a aba do extrato.`;
    parseError('MAPPING_REQUIRED', reason, kind, layoutOf('spreadsheet', tables, suggest(first, first.name).mapping, [reason]));
  }
  if (!chosen && tables.length > 1) warnings.push(`Aba ${selected!.name} escolhida pelo cabeçalho; as demais abas não foram importadas.`);
  const format = `${kind} · aba ${selected!.name.slice(0, 40)}`;
  const result = interpretTable(selected!, tables, { kind: 'spreadsheet', format: kind, mapping: context.mapping && { ...context.mapping, sheet: selected!.name }, profiles: context.profiles });
  return { source: 'spreadsheet' as const, format, accountHint: null, rows: result.rows, warnings: [...warnings, ...result.warnings], layout: result.layout, mapping: result.mapping };
}
