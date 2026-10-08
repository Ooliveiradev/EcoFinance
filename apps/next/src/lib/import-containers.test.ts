import { describe, it, expect } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import * as XLSX from 'xlsx';
import { parseImport, ImportParseError } from './import-parsers';
import { inspectZip } from './import-zip';

interface Entry { name: string; data: Buffer; method?: number; flags?: number; declared?: number; local?: number }
/** Minimal ZIP writer able to produce malformed containers on purpose. */
function zip(entries: Entry[], patch: (central: Buffer, end: Buffer) => void = () => {}) {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8, body = method === 8 ? deflateRawSync(entry.data) : entry.data, name = Buffer.from(entry.name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(entry.flags ?? 0, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc32(entry.data), 16);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(entry.declared ?? entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(entry.local ?? offset, 42);
    locals.push(local, name, body); centrals.push(central, name); offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  patch(directory, end);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
const code = (run: () => unknown) => { try { run(); } catch (cause) { return (cause as ImportParseError).code; } return 'OK'; };
const workbook = { name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') };
const book = (sheets: Record<string, unknown[][]>, hidden: string[] = []) => {
  const value = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(rows), name);
  value.Workbook = { Sheets: Object.keys(sheets).map(name => ({ Hidden: hidden.includes(name) ? 1 : 0 })) };
  return value;
};
const xlsx = (value: XLSX.WorkBook, bookType: XLSX.BookType = 'xlsx') => new Uint8Array(XLSX.write(value, { type: 'buffer', bookType, compression: true }));
const parse = (bytes: Uint8Array, options = {}) => parseImport({ name: 'planilha.xlsx', mime: '', bytes }, options);

describe('ZIP container guard', () => {
  it('accepts consistent stored and deflated entries', () => {
    expect(inspectZip(zip([workbook, { name: 'stored.txt', data: Buffer.from('abc'), method: 0 }]))).toEqual(['xl/workbook.xml', 'stored.txt']);
  });
  it('refuses ZIP64, encryption, duplicates, unknown methods, lies and overlaps', () => {
    const cases: [Uint8Array, string][] = [
      [zip([workbook], (_central, end) => end.writeUInt16LE(0xffff, 10)), 'UNSUPPORTED_FORMAT'],
      [zip([workbook], (_central, end) => end.writeUInt16LE(1, 4)), 'UNSUPPORTED_FORMAT'],
      [zip([workbook], (_central, end) => end.writeUInt16LE(400, 10)), 'UNSAFE_CONTENT'],
      [zip([workbook], (_central, end) => end.writeUInt16LE(2, 10)), 'CORRUPT_FILE'],
      [zip([{ ...workbook, flags: 1 }]), 'PROTECTED_FILE'],
      [zip([workbook, workbook]), 'UNSAFE_CONTENT'],
      [zip([{ ...workbook, method: 12 }]), 'UNSUPPORTED_FORMAT'],
      [zip([{ ...workbook, declared: 9 * 1024 * 1024 }]), 'UNSAFE_CONTENT'],
      [zip([{ ...workbook, local: 1 }]), 'CORRUPT_FILE'],
      [zip([{ ...workbook, method: 0, declared: 3 }]), 'UNSAFE_CONTENT'],
      [zip([{ ...workbook, declared: 3 }]), 'UNSAFE_CONTENT'],
      [zip([{ ...workbook, data: Buffer.from('not deflate'), method: 8 }], central => central.writeUInt32LE(5, 20)), 'UNSAFE_CONTENT'],
      [zip([workbook, { name: 'copy', data: workbook.data, local: 0 }]), 'UNSAFE_CONTENT'],
      [zip([workbook], central => central.writeUInt32LE(0x1000, 20)), 'CORRUPT_FILE'],
    ];
    for (const [bytes, expected] of cases) expect(code(() => inspectZip(bytes))).toBe(expected);
  });
});
describe('spreadsheet reader', () => {
  it('rejects non-spreadsheet containers with specific guidance', () => {
    expect(code(() => parse(zip([{ name: 'xl/workbook.bin', data: Buffer.from('x') }])))).toBe('UNSUPPORTED_FORMAT');
    expect(() => parse(zip([{ name: 'mimetype', data: Buffer.from('application/vnd.oasis.opendocument.spreadsheet') }]))).toThrow('OpenDocument');
    expect(() => parse(zip([{ name: 'word/document.xml', data: Buffer.from('<w/>') }]))).toThrow('não contém uma planilha');
    const word = XLSX.CFB.utils.cfb_new(); XLSX.CFB.utils.cfb_add(word, 'WordDocument', Buffer.alloc(16));
    expect(() => parse(new Uint8Array(XLSX.CFB.write(word, { type: 'buffer' })))).toThrow('Documento OLE');
    expect(code(() => parse(zip([workbook])))).toBe('CORRUPT_FILE');
  });
  it('reads XLS BIFF8 and notes BIFF5 and VBA storages', () => {
    const data = { Extrato: [['Data', 'Descricao', 'Valor'], ['2026-10-01', 'Conta', -1]] };
    const legacy = XLSX.CFB.read(xlsx(book(data), 'biff5'), { type: 'buffer' });
    XLSX.CFB.utils.cfb_add(legacy, '_VBA_PROJECT_CUR/VBA/dir', Buffer.from('synthetic'));
    const parsed = parse(new Uint8Array(XLSX.CFB.write(legacy, { type: 'buffer' })));
    expect(parsed).toMatchObject({ format: 'XLS · aba Extrato', rows: [{ amount: '-1.00', purchaseDate: '2026-10-01' }] });
    expect(parsed.warnings.join(' ')).toMatch(/BIFF5.*|macros/);
  });
  it('maps booleans, errors, empty and invalid date cells without inventing values', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Data', 'Descrição', 'Valor', 'Extra'], [{ t: 'n', v: -1, z: 'dd/mm/yyyy' }, 'Série inválida', 1, true], [{ t: 'n', v: 46296, z: 'yyyy-mm-dd' }, 'Erro', { t: 'e', v: 7, w: '#DIV/0!' }, false], [46296, 'Sem formato de data', 2, null]]);
    const value = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(value, sheet, 'Dados');
    const rows = parse(xlsx(value)).rows;
    expect(rows[0]).toMatchObject({ purchaseDate: null, warnings: [expect.stringContaining('série')] });
    expect(rows[1]).toMatchObject({ purchaseDate: '2026-10-01', amount: null }); expect(rows[1]!.warnings.join(' ')).toContain('erro de planilha');
    expect(rows[2]).toMatchObject({ purchaseDate: null, amount: '2.00' });
    expect(rows[0]!.provenance.excerpt).toContain('VERDADEIRO');
  });
  it('enforces sheet, row and column limits and explicit sheet choice', () => {
    expect(code(() => parse(xlsx(book(Object.fromEntries(Array.from({ length: 25 }, (_, i) => ['S' + i, [['x']]]))))))).toBe('SHEET_LIMIT');
    expect(code(() => parse(xlsx(book({ Grande: Array.from({ length: 2002 }, (_, i) => ['2026-10-01', 'Linha ' + i, 1]) }))))).toBe('ROW_LIMIT');
    const wide = XLSX.utils.aoa_to_sheet([['Data', 'Descrição', 'Valor']]); wide['BA2'] = { t: 's', v: 'fora' }; wide['!ref'] = 'A1:BA2';
    const value = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(value, wide, 'Larga');
    expect(code(() => parse(xlsx(value)))).toBe('COLUMN_LIMIT');
    expect(code(() => parse(xlsx(book({ Vazia: [[]], Oculta: [['x']] }, ['Oculta']))))).toBe('NO_ROWS');
    const two = xlsx(book({ A: [['Data', 'Descrição', 'Valor'], ['2026-10-01', 'a', 1]], B: [['Data', 'Descrição', 'Valor'], ['2026-10-02', 'b', 2]] }));
    const mapping = { sheet: 'Z', headerRow: 1, date: 0, description: 1, amount: 2, debit: null, credit: null, dateOrder: null, decimal: null };
    expect(() => parse(two, { mapping })).toThrow('não existe');
    expect(parse(two, { mapping: { ...mapping, sheet: 'B' } }).rows[0]!.provenance.cell).toBe('B!C2');
    expect(code(() => parse(two, { mapping: { ...mapping, sheet: 'B', amount: 9 } }))).toBe('MAPPING_REQUIRED');
    const unnamed = xlsx(book({ Notas: [['texto livre'], ['mais texto']], Dados: [['2026-10-01', 'x', 1], ['2026-10-02', 'y', 2]] }));
    expect(() => parse(unnamed)).toThrow('2 abas');
  });
});
