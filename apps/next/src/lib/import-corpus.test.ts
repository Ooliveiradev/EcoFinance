import { describe, it, expect } from 'vitest';
import { moneyToCents, centsToMoney } from '@ecofinance/shared';
import { parseImport, ImportParseError } from './import-parsers';
import { corpus, corpusBytes } from '../../../../tests/fixtures/imports/corpus';

const parse = (file: string, mime: string, options = {}) => parseImport({ name: file, mime, bytes: corpusBytes(file) }, options);
function failure(run: () => unknown) {
  try { run(); } catch (cause) { if (cause instanceof ImportParseError) return cause; throw cause; }
  throw new Error('expected an import diagnostic');
}
describe('synthetic import corpus', () => {
  it.each(corpus.map(entry => [entry.file, entry] as const))('%s matches its hand-written expectation', (_name, entry) => {
    if (entry.error) {
      const error = failure(() => parse(entry.file, entry.mime));
      expect(error.code).toBe(entry.error); expect(error.message.length).toBeGreaterThan(20);
      return;
    }
    let options = {};
    if (entry.mappingRequired) {
      const error = failure(() => parse(entry.file, entry.mime));
      expect(error.code).toBe('MAPPING_REQUIRED'); expect(error.message).toContain(entry.mappingRequired);
      expect(error.layout!.sheets.length).toBeGreaterThan(0); expect(error.layout!.reasons.join(' ')).toContain(entry.mappingRequired);
      options = { mapping: entry.mapping };
    }
    const parsed = parse(entry.file, entry.mime, options);
    if (entry.format) expect(parsed.format).toBe(entry.format);
    expect(parsed.rows.map(row => [row.amount, row.purchaseDate, row.description, row.provenance.cell ?? row.provenance.row])).toEqual(entry.rows);
    const valid = parsed.rows.filter(row => row.amount && row.purchaseDate && row.description);
    expect(valid).toHaveLength(entry.valid!);
    expect(centsToMoney(valid.reduce((sum, row) => sum + moneyToCents(row.amount!), 0n))).toBe(entry.total);
    // Every invalid row stays visible with at least one actionable warning.
    for (const row of parsed.rows.filter(row => !valid.includes(row))) expect(row.warnings.length).toBeGreaterThan(0);
    for (const warning of entry.warnings ?? []) expect(parsed.warnings.join(' ')).toContain(warning);
    if (entry.externalId) expect(parsed.rows[0]!.externalId).toBe(entry.externalId);
    for (const row of parsed.rows) expect(row.provenance.excerpt!.length).toBeGreaterThan(0);
  });
  it('recognizes every successful case by content even with a wrong name and generic MIME', () => {
    for (const entry of corpus.filter(entry => !entry.error)) {
      const options = entry.mapping ? { mapping: entry.mapping } : {};
      const parsed = parseImport({ name: 'download.bin', mime: 'application/octet-stream', bytes: corpusBytes(entry.file) }, options);
      expect(parsed.rows).toHaveLength(entry.rows!.length);
      expect(parsed.warnings.join(' ')).toContain('Extensão não corresponde');
    }
  });
  it('reuses a saved profile for the same layout without asking again', () => {
    const entry = corpus.find(item => item.file === 'csv-unknown-layout.txt')!;
    const layout = failure(() => parse(entry.file, entry.mime)).layout!;
    const parsed = parse(entry.file, entry.mime, { profiles: { [layout.sheets[0]!.fingerprint]: entry.mapping! } });
    expect(parsed.rows).toHaveLength(3); expect(parsed.warnings.join(' ')).toContain('Mapeamento salvo');
    expect(parsed.layout!.suggestion).toMatchObject({ headerRow: 0, date: 0, description: 1, amount: 2 });
    const sheets = failure(() => parse('xlsx-two-statements.xlsx', '')).layout!;
    const card = sheets.sheets.find(sheet => sheet.name === 'Cartão')!;
    expect(parse('xlsx-two-statements.xlsx', '', { profiles: { [card.fingerprint]: corpus.find(item => item.file === 'xlsx-two-statements.xlsx')!.mapping! } }).format).toBe('XLSX · aba Cartão');
  });
});
