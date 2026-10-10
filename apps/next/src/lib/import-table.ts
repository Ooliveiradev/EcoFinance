import { createHash } from 'node:crypto';
import { IMPORT_LIMITS, IMPORT_MAPPING_LIMITS, type ImportLayout, type ImportLayoutSheet, type ImportMapping, type ParsedImportRow } from '@ecofinance/shared';
import { parseError } from './import-errors';
import { amountFromNumber, decimalEvidence, inferDateOrder, inferDecimal, parseAmountText, parseDateText, type ValueResult } from './import-values';

/**
 * Common interpretation of CSV/TSV and spreadsheet grids: header recognition,
 * saved/assisted mapping and per-row evidence. Ambiguity stops with a layout for
 * the user to confirm instead of choosing a date order or decimal separator.
 */
export interface TableCell { text: string; number?: number; date?: string | null; formula?: boolean; error?: boolean }
export interface TableRow { line: number; cells: TableCell[] }
export interface Table { name: string; rows: TableRow[]; ref: (line: number, column: number) => string; separator: string | null }
export interface TableContext { kind: ImportLayout['kind']; format: string; mapping: ImportMapping | null; profiles: Record<string, ImportMapping> }
export interface TableResult { rows: ParsedImportRow[]; warnings: string[]; mapping: ImportMapping }
type Role = 'date' | 'description' | 'amount' | 'debit' | 'credit';

export const normalizeHeader = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/r\$/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const aliases: Record<Role, string[]> = {
  date: ['data', 'date', 'dt', 'dia', 'purchase date', 'data lancamento', 'data do lancamento', 'data de lancamento', 'data movimento', 'data mov', 'data movimentacao', 'data transacao', 'data da transacao', 'data compra', 'data da compra', 'data operacao', 'posted date', 'posting date', 'transaction date', 'data contabil'],
  description: ['descricao', 'description', 'historico', 'memo', 'lancamento', 'detalhes', 'detalhe', 'estabelecimento', 'titulo', 'title', 'payee', 'nome', 'name', 'details', 'descricao do lancamento', 'historico do lancamento', 'movimentacao', 'transacao'],
  amount: ['valor', 'amount', 'value', 'quantia', 'montante', 'valor em reais', 'valor brl', 'valor lancamento', 'valor do lancamento', 'valor transacao'],
  debit: ['debito', 'debitos', 'debit', 'saida', 'saidas', 'valor debito'],
  credit: ['credito', 'creditos', 'credit', 'entrada', 'entradas', 'valor credito'],
};
const roleOf = new Map(Object.entries(aliases).flatMap(([role, names]) => names.map(name => [name, role as Role])));
/** Column role named by a header text, shared with the document reader's table headers. */
export const headerRole = (text: string): Role | null => roleOf.get(normalizeHeader(text)) ?? null;
const scanRows = 20;

function roles(row: TableRow) {
  const found: Record<Role, number[]> = { date: [], description: [], amount: [], debit: [], credit: [] };
  row.cells.forEach((cell, index) => { const role = roleOf.get(normalizeHeader(cell.text)); if (role) found[role].push(index); });
  return found;
}
/** First row (within the first 20) that names date, description and amount or debit+credit. */
function header(table: Table) {
  for (const row of table.rows.slice(0, scanRows)) {
    const found = roles(row), single = (role: Role) => found[role].length === 1;
    const amount = single('amount') && !found.debit.length && !found.credit.length, split = !found.amount.length && single('debit') && single('credit');
    if (single('date') && single('description') && (amount || split)) return { row, found, duplicated: false };
    if (found.date.length && found.description.length && (found.amount.length || found.debit.length || found.credit.length)) return { row, found, duplicated: true };
  }
  return null;
}
const isValueLike = (cell: TableCell) => cell.number !== undefined || cell.date !== undefined || decimalEvidence(cell.text) !== null || /^[-+(]?\d+\)?$/.test(cell.text.trim()) || parseDateText(cell.text, 'dmy').value !== null;
/** Header-like row used as layout identity, independent of how the user maps it. */
function signatureRow(table: Table) {
  return header(table)?.row ?? table.rows.slice(0, scanRows).find(row => row.cells.filter(cell => cell.text.trim()).length >= 2 && row.cells.every(cell => !cell.text.trim() || !isValueLike(cell))) ?? null;
}
export function columnCount(table: Table) { return Math.max(0, ...table.rows.map(row => row.cells.length)); }
export function preview(table: Table): ImportLayoutSheet {
  const signature = signatureRow(table), columns = columnCount(table);
  const identity = signature ? signature.cells.map(cell => normalizeHeader(cell.text)) : ['columns:' + columns];
  return {
    name: table.name, columns, headerRow: signature?.line ?? 0,
    fingerprint: createHash('sha256').update(JSON.stringify(['import-layout', table.name, table.separator, identity])).digest('hex').slice(0, 32),
    sample: table.rows.slice(0, IMPORT_MAPPING_LIMITS.sampleRows).map(row => ({ line: row.line, cells: row.cells.slice(0, 20).map(cell => cell.text.trim().slice(0, IMPORT_MAPPING_LIMITS.sampleText)) })),
  };
}
/** Content-based guess for files without a recognized header. */
function guessColumns(table: Table, headerRow: number) {
  const rows = table.rows.filter(row => row.line > headerRow).slice(0, scanRows), columns = columnCount(table);
  const score = (test: (cell: TableCell) => boolean, skipped: number[]) => {
    const skip = new Set(skipped);
    let best = -1, count = 0;
    for (let index = 0; index < columns; index++) {
      if (skip.has(index)) continue;
      const hits = rows.filter(row => row.cells[index] && test(row.cells[index]!)).length;
      if (hits > count) { best = index; count = hits; }
    }
    return best;
  };
  const date = score(cell => cell.date !== undefined || parseDateText(cell.text, 'dmy').value !== null || parseDateText(cell.text, 'mdy').value !== null, []);
  const amount = score(cell => cell.number !== undefined || parseAmountText(cell.text, ',').value !== null || parseAmountText(cell.text, '.').value !== null, [date]);
  const description = score(cell => !!cell.text.trim() && !isValueLike(cell), [date, amount]);
  const fallback = [0, 1, 2].filter(index => ![date, amount, description].includes(index));
  return { date: date < 0 ? fallback.shift()! : date, amount: amount < 0 ? fallback.shift()! : amount, description: description < 0 ? fallback.shift()! : description };
}
export function suggest(table: Table, sheet: string | null): { mapping: ImportMapping; reasons: string[] } {
  const found = header(table), base = { sheet, dateOrder: null, decimal: null };
  if (found && !found.duplicated) {
    const { date, description, amount, debit, credit } = found.found;
    return { mapping: { ...base, headerRow: found.row.line, date: date[0]!, description: description[0]!, amount: amount[0] ?? null, debit: amount.length ? null : debit[0]!, credit: amount.length ? null : credit[0]! }, reasons: [] };
  }
  const headerRow = found?.row.line ?? preview(table).headerRow, guess = guessColumns(table, headerRow);
  const reasons = [found ? 'O cabeçalho repete colunas de data, descrição ou valor. Escolha qual coluna usar.' : 'Cabeçalho com data, descrição e valor não reconhecido. Indique as colunas.'];
  return { mapping: { ...base, headerRow, ...guess, debit: null, credit: null }, reasons };
}
function mappingFits(table: Table, mapping: ImportMapping) {
  const columns = columnCount(table);
  return [mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit].every(index => index === null || index < columns);
}
const cellText = (cell: TableCell | undefined) => cell?.text.trim() ?? '';
function amountOf(cell: TableCell | undefined, decimal: ImportMapping['decimal']): ValueResult {
  if (cell?.number !== undefined) return amountFromNumber(cell.number);
  return parseAmountText(cellText(cell), decimal);
}
function splitAmount(debit: TableCell | undefined, credit: TableCell | undefined, decimal: ImportMapping['decimal']): ValueResult & { used: 'debit' | 'credit' } {
  const hasDebit = !!cellText(debit) || debit?.number !== undefined, hasCredit = !!cellText(credit) || credit?.number !== undefined;
  if (hasDebit && hasCredit) return { value: null, used: 'debit', warning: 'Débito e crédito preenchidos na mesma linha; informe o valor com sinal.' };
  if (!hasDebit && !hasCredit) return { value: null, used: 'debit', warning: 'Débito e crédito vazios.' };
  const result = amountOf(hasDebit ? debit : credit, decimal), magnitude = result.value?.replace(/^-/, '') ?? null;
  return { ...result, used: hasDebit ? 'debit' : 'credit', value: magnitude && (hasDebit ? '-' + magnitude : magnitude) };
}
/** Validate ambiguity at file level, then build one visible row per data line. */
function extract(table: Table, mapping: ImportMapping, context: TableContext) {
  const reasons: string[] = [];
  if (mapping.headerRow && !table.rows.some(row => row.line === mapping.headerRow)) reasons.push(`A linha de cabeçalho ${mapping.headerRow} está vazia ou não existe.`);
  const data = table.rows.filter(row => row.line > mapping.headerRow), before = table.rows.filter(row => row.line < mapping.headerRow);
  if (!data.length) parseError('NO_ROWS', 'Arquivo sem movimentações após o cabeçalho. Confira o período exportado.', context.format);
  if (data.length > IMPORT_LIMITS.rows) parseError('ROW_LIMIT', `Divida o arquivo em até ${IMPORT_LIMITS.rows} movimentações por arquivo.`, context.format);
  const texts = (index: number | null) => index === null ? [] : data.flatMap(row => { const cell = row.cells[index]; return cell && cell.number === undefined && cell.date === undefined ? [cell.text] : []; });
  const dates = inferDateOrder(texts(mapping.date)), decimals = inferDecimal([mapping.amount, mapping.debit, mapping.credit].flatMap(texts));
  if (!mapping.dateOrder && dates.conflict) reasons.push('A coluna de datas mistura DD/MM e MM/DD. Escolha a ordem e corrija as linhas divergentes na revisão.');
  else if (!mapping.dateOrder && !dates.order && dates.ambiguous) reasons.push('Datas ambíguas como 01/02 podem ser 1º de fevereiro ou 2 de janeiro. Escolha a ordem DD/MM ou MM/DD.');
  if (!mapping.decimal && decimals.conflict) reasons.push('Os valores misturam vírgula e ponto como separador decimal. Escolha o separador.');
  else if (!mapping.decimal && !decimals.decimal && decimals.ambiguous) reasons.push('Valores como 1.234 podem ser mil duzentos e trinta e quatro ou ter três casas decimais. Escolha o separador decimal.');
  if (reasons.length) return { reasons, rows: [], warnings: [] };
  const order = mapping.dateOrder ?? dates.order, decimal = mapping.decimal ?? decimals.decimal;
  const width = table.separator ? table.rows.find(row => row.line === mapping.headerRow)?.cells.length ?? null : null;
  const rows = data.map((row): ParsedImportRow => {
    const dateCell = row.cells[mapping.date];
    const date: ValueResult = dateCell?.date !== undefined ? (dateCell.date ? { value: dateCell.date } : { value: null, warning: 'Célula de data com número de série inválido.' }) : parseDateText(cellText(dateCell), order);
    const amount = mapping.amount !== null ? { ...amountOf(row.cells[mapping.amount], decimal), used: 'amount' as const } : splitAmount(row.cells[mapping.debit!], row.cells[mapping.credit!], decimal);
    const amountColumn = amount.used === 'amount' ? mapping.amount! : amount.used === 'debit' ? mapping.debit! : mapping.credit!;
    const description = cellText(row.cells[mapping.description]) || null;
    const used = [mapping.date, mapping.description, amountColumn];
    const warnings = [date.warning, amount.warning, !description && 'Descrição ausente.',
      description && description.length > 500 && 'Descrição reduzida a 500 caracteres; confira o original.',
      description && /^[=+@]/.test(description) && 'Descrição começa com caractere de fórmula; mantida apenas como texto.',
      description && /^(saldo|total)\b/i.test(description) && 'Parece uma linha de saldo ou total; exclua se não for movimentação.',
      ...used.flatMap(index => row.cells[index]?.formula ? [`Célula ${table.ref(row.line, index)} contém fórmula; usado o valor salvo no arquivo, sem recalcular.`] : []),
      ...used.flatMap(index => row.cells[index]?.error ? [`Célula ${table.ref(row.line, index)} contém erro de planilha.`] : []),
      width !== null && row.cells.length !== width && 'Quantidade de colunas divergente; confira a linha.',
    ].filter((warning): warning is string => !!warning);
    return { amount: amount.value, purchaseDate: date.value, description: description?.slice(0, 500) ?? null, externalId: null,
      provenance: { row: row.line, cell: table.ref(row.line, amountColumn), excerpt: row.cells.map(cell => cell.text).join(table.separator ?? ' | ').slice(0, 500) }, warnings };
  });
  const warnings = before.length ? [`${before.length} linha(s) antes do cabeçalho (linha ${mapping.headerRow}) não são movimentações e ficaram fora da revisão.`] : [];
  return { reasons, rows, warnings };
}
/** Build the layout returned with MAPPING_REQUIRED and persisted for later remapping. */
export function layoutOf(kind: ImportLayout['kind'], tables: Table[], suggestion: ImportMapping, reasons: string[]): ImportLayout {
  return { kind, sheets: tables.map(preview), suggestion, reasons };
}
export function interpretTable(table: Table, tables: Table[], context: TableContext): TableResult & { layout: ImportLayout } {
  const sheet = context.kind === 'spreadsheet' ? table.name : null, fingerprint = preview(table).fingerprint;
  const saved = context.profiles[fingerprint], fallback = suggest(table, sheet);
  const candidate = context.mapping ?? (saved && mappingFits(table, saved) ? { ...saved, sheet } : null);
  const mapping = candidate ?? fallback.mapping;
  if (!mappingFits(table, mapping)) parseError('MAPPING_REQUIRED', 'O mapeamento indica colunas inexistentes. Escolha as colunas novamente.', context.format, layoutOf(context.kind, tables, fallback.mapping, ['Colunas fora do arquivo.']));
  if (!candidate && fallback.reasons.length) parseError('MAPPING_REQUIRED', fallback.reasons.join(' '), context.format, layoutOf(context.kind, tables, mapping, fallback.reasons));
  const result = extract(table, mapping, context);
  if (result.reasons.length) parseError('MAPPING_REQUIRED', result.reasons.join(' '), context.format, layoutOf(context.kind, tables, mapping, result.reasons));
  const source = context.mapping ? ['Mapeamento de colunas confirmado pelo usuário aplicado.'] : candidate ? ['Mapeamento salvo para este layout aplicado; confira as colunas.'] : [];
  return { rows: result.rows, warnings: [...source, ...result.warnings], mapping, layout: layoutOf(context.kind, tables, mapping, []) };
}
