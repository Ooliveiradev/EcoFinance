import { describe, it, expect } from 'vitest';
import { parseImport, delimitedRows, ImportParseError, type ImportFile, type ImportParser } from './import-parsers';
import { IMPORT_LIMITS } from '@ecofinance/shared';
const file = (text: string, patch: Partial<ImportFile> = {}): ImportFile => ({ name: 'extrato.csv', mime: 'text/csv', bytes: new TextEncoder().encode(text), ...patch });
const code = (run: () => unknown) => { try { run(); } catch (cause) { return (cause as ImportParseError).code; } return 'OK'; };
const ofx = '<OFX><CURDEF>BRL\n<BANKID>001\n<ACCTID>123\n<STMTTRN><DTPOSTED>20261001120000[-3:BRT]\n<TRNAMT>-0.10\n<FITID>A\n<NAME>Mercado\n</STMTTRN></OFX>';
describe('extensible import parser registry', () => {
  it('detects signatures despite misleading extension and MIME and preserves exact OFX evidence', () => {
    const parsed = parseImport(file(ofx, { name: 'foto.bin', mime: 'image/png' }));
    expect(parsed).toMatchObject({ format: 'OFX SGML', source: 'ofx', accountHint: '123', rows: [{ amount: '-0.10', purchaseDate: '2026-10-01', externalId: '001:123:A', description: 'Mercado' }] });
    expect(parsed.warnings).toHaveLength(2); expect(parsed.rows[0]!.provenance.row).toBe(4);
    expect(parseImport(file(ofx.toLowerCase().replace('brl', 'BRL'))).rows[0]!.amount).toBe('-0.10');
  });
  it('keeps malformed OFX rows visible and rejects incomplete blocks, entities or wrong currency', () => {
    const invalid = ofx.replace('20261001120000[-3:BRT]', '20260230').replace('-0.10', '1.234').replace('<FITID>A', '').replace('<NAME>Mercado', '');
    expect(parseImport(file(invalid)).rows[0]).toMatchObject({ amount: null, purchaseDate: null, description: null, externalId: null });
    expect(parseImport(file(invalid)).rows[0]!.warnings).toHaveLength(4);
    for (const broken of [ofx.replace('</OFX>', ''), ofx.replace('</STMTTRN>', ''), '<!ENTITY attack>\n' + ofx, ofx.replace('BRL', 'USD'), '<OFX><CURDEF>BRL</CURDEF></OFX>']) expect(() => parseImport(file(broken))).toThrow();
  });
  it('reads localized CSV/TSV with BOM, quoted separators, doubled quotes and multiline provenance', () => {
    const parsed = parseImport(file('\ufeffdata;descrição;valor\r\n15/10/2026;"Mercado; ""loja""\ncentro";-1.234,56\r\n2026-10-02;Outro;0,30'));
    expect(parsed.rows).toMatchObject([{ amount: '-1234.56', purchaseDate: '2026-10-15', description: 'Mercado; "loja"\ncentro', provenance: { row: 2, cell: 'C2' } }, { amount: '0.30', provenance: { row: 4 } }]);
    expect(parseImport(file('date\tdescription\tamount\n2026-10-01\tSalário\t100.25')).rows[0]!.amount).toBe('100.25');
    expect(parseImport(file('date,description,amount\n2026-10-01,Compra,-0.10')).rows[0]!.amount).toBe('-0.10');
    expect(parseImport(file('sep=,\ndata,descricao,valor\n2026-10-01,"Compra" ,-0.10')).rows[0]).toMatchObject({ description: 'Compra', provenance: { row: 3 } });
  });
  it('diagnoses empty, corrupt, binary, unsupported, ambiguous and resource-limited files', () => {
    const expected: [string, string][] = [['', 'EMPTY_FILE'], ['%PDF-1.7', 'UNSUPPORTED_FORMAT'], ['data;descricao;valor', 'NO_ROWS'], ['data;descricao;valor\n2026-10-01;"bad;-10', 'CORRUPT_FILE'],
      ['data;descricao;valor\n2026-10-01;"closed"x;-10', 'CORRUPT_FILE'], ['data;descricao;valor\n2026-10-01;bad";-10', 'CORRUPT_FILE'], ['data;descricao;valor;amount\n2026-10-01;a;10;10', 'MAPPING_REQUIRED'],
      ['irreconhecível', 'UNSUPPORTED_FORMAT'], ['binary\0', 'CORRUPT_FILE'], ['data;descricao;valor\n' + '2026-10-01;Compra;-10\n'.repeat(IMPORT_LIMITS.rows + 1), 'ROW_LIMIT'],
      [ofx.replace('</OFX>', ofx.match(/<STMTTRN>.*?\/STMTTRN>/s)![0].repeat(60) + '</OFX>'), 'ROW_LIMIT'], ['<html><table><tr><td>x</td></tr></table></html>', 'UNSUPPORTED_FORMAT'],
      [['data', 'descricao', 'valor', ...Array.from({ length: 50 }, (_, i) => 'x' + i)].join(';') + '\n2026-10-01;a;1' + ';x'.repeat(50), 'COLUMN_LIMIT']];
    for (const [text, error] of expected) expect([text.slice(0, 30), code(() => parseImport(file(text)))]).toEqual([text.slice(0, 30), error]);
    expect(() => parseImport(file('x', { bytes: new Uint8Array(IMPORT_LIMITS.bytes + 1) }))).toThrow('256');
    expect(() => parseImport(file('x', { bytes: new Uint8Array([0x81, 0x41]) }))).toThrow('Windows-1252');
    expect(() => parseImport(file('x', { bytes: new Uint8Array([0xff, 0xfe, 0x00, 0xd8]) }))).toThrow('Codificação');
    expect(code(() => parseImport(file('x', { bytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) })))).toBe('CORRUPT_FILE');
    expect(code(() => parseImport(file('x', { bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]) })))).toBe('CORRUPT_FILE');
    const ambiguous: ImportParser[] = [{ format: 'custom', detect: () => true, parse: () => ({ source: 'csv', accountHint: null, rows: [] }) }, { format: 'other', detect: () => true, parse: () => ({ source: 'csv', accountHint: null, rows: [] }) }];
    expect(() => parseImport(file('x'), { parsers: ambiguous })).toThrow('ambíguo');
  });
  it('preserves invalid CSV rows and notices missing/extra cells and truncation', () => {
    const parsed = parseImport(file('data;descricao;valor\ninvalid;;zero\n2026-10-01;Compra;-10;extra\n2026-10-02;' + 'a'.repeat(501) + ';1\n2026-10-03;=SOMA(A1);1\n2026-10-04;Total do mês;5'));
    expect(parsed.rows[0]).toMatchObject({ amount: null, purchaseDate: null, description: null });
    expect(parsed.rows[1]!.warnings[0]).toContain('colunas'); expect(parsed.rows[2]!.warnings[0]).toContain('500');
    expect(parsed.rows[3]!.warnings[0]).toContain('fórmula'); expect(parsed.rows[4]!.warnings[0]).toContain('saldo ou total');
    expect(delimitedRows('a;b\n\n', ';')).toEqual([{ cells: ['a', 'b'], line: 1 }]);
    const header = ['data', 'descricao', ...Array.from({ length: 25 }, (_, i) => 'extra' + i), 'valor'].join(';'), values = ['2026-10-01', 'Compra', ...Array(25).fill('x'), '-10'].join(';');
    expect(parseImport(file(header + '\n' + values)).rows[0]!.provenance.cell).toBe('AB2');
    expect(() => parseImport(file(ofx.replace('<ACCTID>123', '<ACCTID>' + 'a'.repeat(201))))).toThrow('identificação');
    expect(() => parseImport(file(ofx.replace('<FITID>A', '<FITID>' + 'a'.repeat(201))))).toThrow('FITID');
  });
  it('supports binary adapters through the registry and enforces their row envelope', () => {
    const binary = file('', { bytes: new Uint8Array([0xff, 0, 0, 0]) });
    const parser: ImportParser = { format: 'CUSTOM', detect: (_text, input) => input.bytes[0] === 0xff, parse: (_text, input) => ({ source: 'document', accountHint: null, rows: [{ description: 'Binary ' + input.bytes.length, amount: '-1.00', purchaseDate: '2026-10-01', externalId: null, provenance: { page: 1 }, warnings: [] }] }) };
    expect(parseImport(binary, { parsers: [parser] })).toMatchObject({ format: 'CUSTOM', source: 'document', rows: [{ description: 'Binary 4', provenance: { page: 1 } }] });
    expect(() => parseImport(binary, { parsers: [{ ...parser, parse: () => ({ source: 'document', accountHint: null, rows: [] }) }] })).toThrow('1 e 60');
    expect(() => parseImport(binary, { parsers: [{ ...parser, parse: () => { throw new ImportParseError('X', 'falha') } }] })).toThrow(expect.objectContaining({ format: 'CUSTOM' }));
    try { parseImport(file(ofx.replace('BRL', 'USD'))); } catch (cause) { expect(cause).toMatchObject({ format: 'OFX/QFX' }); }
  });
});
