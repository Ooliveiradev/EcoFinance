import { IMPORT_MAPPING_LIMITS, type ImportMapping, type ParsedImportRow } from '@ecofinance/shared';
import { parseError } from './import-errors';
import { interpretTable, normalizeHeader, type Table } from './import-table';
import { cellColumn } from './import-values';

const FORMAT = 'CSV/TSV';
const separators = [';', '\t', ',', '|'] as const;
const names: Record<string, string> = { ';': 'ponto e vírgula', '\t': 'tabulação', ',': 'vírgula', '|': 'barra vertical' };

/** RFC-style quoting, including embedded separators/newlines and doubled quotes. */
export function delimitedRows(text: string, separator: string, firstLine = 1) {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = firstLine, startLine = firstLine;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { cell += c; if (c === '\n') line++; }
    } else if (c === '"' && !cell.trim() && !closed) { quoted = true; cell = ''; }
    else if (c === separator) { cells.push(cell); cell = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cells.push(cell); if (cells.some(value => value.trim())) rows.push({ cells, line: startLine });
      cells = []; cell = ''; closed = false; line++; startLine = line;
    } else {
      if (closed && c.trim() || c === '"') parseError('CORRUPT_FILE', `Aspas inválidas na linha ${line}. Exporte CSV/TSV novamente.`, FORMAT);
      if (!closed) cell += c;
    }
  }
  if (quoted) parseError('CORRUPT_FILE', `Campo com aspas incompletas na linha ${startLine}.`, FORMAT);
  cells.push(cell); if (cells.some(value => value.trim())) rows.push({ cells, line: startLine });
  return rows;
}
const known = new Set(['data', 'date', 'descricao', 'description', 'historico', 'valor', 'amount', 'debito', 'credito', 'memo', 'value']);
/**
 * Choose the separator by content: a recognized header wins, otherwise the most
 * consistent column count. An Excel `sep=` hint line is honored.
 */
export function detectDelimiter(text: string) {
  const hint = /^sep=(.)\r?\n/i.exec(text), body = hint ? text.slice(hint[0].length) : text, offset = hint ? 2 : 1;
  const candidates = (hint ? [hint[1]!] : separators).flatMap(separator => {
    let rows: ReturnType<typeof delimitedRows>;
    try { rows = delimitedRows(body, separator, offset); }
    catch {
      // A recognized header with broken quoting is still CSV: parsing reports the line.
      const first = body.split(/\r?\n/, 1)[0]!.split(separator).filter(cell => known.has(normalizeHeader(cell))).length >= 2;
      return first ? [{ separator, rows: [], header: true, score: 0 }] : [];
    }
    const counts = rows.slice(0, 50).map(row => row.cells.length), frequency = new Map<number, number>();
    for (const count of counts) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    const [width, hits] = [...frequency].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    const header = rows.slice(0, 20).some(row => row.cells.filter(cell => known.has(normalizeHeader(cell))).length >= 2);
    return width >= 2 && (header || rows.length >= 2) ? [{ separator, rows, header, score: (hits / counts.length) * Math.log2(width) }] : [];
  });
  return candidates.sort((a, b) => Number(b.header) - Number(a.header) || b.score - a.score)[0] ?? null;
}
export function parseDelimited(text: string, context: { encoding: string; mapping: ImportMapping | null; profiles: Record<string, ImportMapping> }) {
  const detected = detectDelimiter(text);
  if (!detected) return parseError('UNSUPPORTED_FORMAT', 'Texto sem colunas separadas por ponto e vírgula, tabulação, vírgula ou barra vertical.', FORMAT);
  if (!detected.rows.length) delimitedRows(text.replace(/^sep=.\r?\n/i, ''), detected.separator);
  if (detected.rows.some(row => row.cells.length > IMPORT_MAPPING_LIMITS.columns)) parseError('COLUMN_LIMIT', `O arquivo tem mais de ${IMPORT_MAPPING_LIMITS.columns} colunas. Exporte apenas as colunas do extrato.`, FORMAT);
  const table: Table = { name: '', separator: detected.separator, ref: (line, column) => `${cellColumn(column)}${line}`,
    rows: detected.rows.map(row => ({ line: row.line, cells: row.cells.map(text => ({ text })) })) };
  const format = `${FORMAT} · ${names[detected.separator]} · ${context.encoding}`;
  const result = interpretTable(table, [table], { kind: 'delimited', format, mapping: context.mapping && { ...context.mapping, sheet: null }, profiles: context.profiles });
  return { source: 'csv' as const, format, accountHint: null, rows: result.rows as ParsedImportRow[], warnings: result.warnings, layout: result.layout, mapping: result.mapping };
}
