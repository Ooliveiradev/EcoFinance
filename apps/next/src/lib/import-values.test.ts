import { describe, it, expect } from 'vitest';
import { amountFromNumber, cellColumn, decimalEvidence, inferDateOrder, inferDecimal, parseAmountText, parseDateText } from './import-values';
import { decodeText, declaredCharset } from './import-text';
import { ofxAmount, ofxDate, ofxValue } from './import-ofx';

describe('exact text values', () => {
  it('parses civil dates without inventing day/month order', () => {
    expect(parseDateText('2026-10-01', null).value).toBe('2026-10-01');
    expect(parseDateText('20261001', null).value).toBe('2026-10-01');
    expect(parseDateText('2026/10/01 23:59:59', null).value).toBe('2026-10-01');
    expect(parseDateText('2026-10-01T23:30:00Z', null).value).toBe('2026-10-01');
    expect(parseDateText('1 de outubro de 2026', null).value).toBe('2026-10-01');
    expect(parseDateText('05-Dec-26', null)).toEqual({ value: '2026-12-05', warning: expect.stringContaining('2026') });
    expect(parseDateText('01/01/95', 'dmy')).toEqual({ value: '1995-01-01', warning: expect.stringContaining('1995') });
    expect(parseDateText('25/10/2026', null).value).toBe('2026-10-25');
    expect(parseDateText('10/25/2026', null).value).toBe('2026-10-25');
    expect(parseDateText('03/03/2026', null).value).toBe('2026-03-03');
    expect(parseDateText('01/02/2026', null)).toMatchObject({ value: null, warning: expect.stringContaining('ambígua') });
    expect(parseDateText('01/02/2026', 'dmy').value).toBe('2026-02-01');
    expect(parseDateText('01/02/2026', 'mdy').value).toBe('2026-01-02');
    expect(parseDateText('01/02/2026', 'ymd').warning).toContain('AAAA-MM-DD');
    expect(parseDateText('25/10/2026', 'mdy').warning).toContain('MM/DD');
    expect(parseDateText('10/25/2026', 'dmy').warning).toContain('DD/MM');
    expect(parseDateText('2026-02-30', null).warning).toContain('inexistente');
    expect(parseDateText('', null).warning).toContain('ausente');
    expect(parseDateText('ontem', null).warning).toContain('não reconhecido');
    expect(parseDateText('01 xyz 2026', null).value).toBeNull();
  });
  it('infers date order only from disambiguating values', () => {
    expect(inferDateOrder(['01/02/2026', '25/02/2026'])).toEqual({ order: 'dmy', conflict: false, ambiguous: true });
    expect(inferDateOrder(['02/25/2026'])).toMatchObject({ order: 'mdy' });
    expect(inferDateOrder(['25/02/2026', '02/25/2026'])).toMatchObject({ order: null, conflict: true });
    expect(inferDateOrder(['2026-01-02', '03/03/2026', 'x'])).toEqual({ order: null, conflict: false, ambiguous: false });
  });
  it('parses money with explicit separators, signs and debit/credit markers', () => {
    const cases: [string, ',' | '.' | null, string | null][] = [
      ['-1.234,56', null, '-1234.56'], ['1,234.56', null, '1234.56'], ['R$ 10,00 D', null, '-10.00'], ['10,00C', null, '10.00'], ['(5.00)', null, '-5.00'],
      ['10.50-', null, '-10.50'], ['+3', null, '3.00'], ['\u22127,5', null, '-7.50'], ['1.234.567', null, '1234567.00'], ['1,234,567', null, '1234567.00'],
      ['1.234', ',', '1234.00'], ['1.234', '.', null], ['1,5', '.', null], ['1.234', null, null], ['10,123', ',', null], ['1.2.3,00', null, null],
      ['12.34.567,00', null, null], ['0,00', null, null], ['abc', null, null], ['', null, null], ['99999999999999,00', null, null], ['007,10', null, '7.10'],
    ];
    for (const [raw, decimal, expected] of cases) expect([raw, parseAmountText(raw, decimal).value]).toEqual([raw, expected]);
    expect(parseAmountText('1.234', null).warning).toContain('ambíguo');
    expect(parseAmountText('1,5', '.').warning).toContain('diverge');
    expect(decimalEvidence('1,2345')).toBeNull(); expect(decimalEvidence('x')).toBeNull(); expect(decimalEvidence('10')).toBeNull();
    expect(inferDecimal(['1,50', '2.50'])).toMatchObject({ decimal: null, conflict: true });
    expect(inferDecimal(['1.234', '10,00'])).toEqual({ decimal: ',', conflict: false, ambiguous: true });
  });
  it('keeps spreadsheet numbers exact and reports extra precision', () => {
    expect(amountFromNumber(-10.25).value).toBe('-10.25');
    expect(amountFromNumber(2000).value).toBe('2000.00');
    expect(amountFromNumber(0.1 + 0.2).warning).toContain('duas casas');
    expect(amountFromNumber(1e21).warning).toContain('formato');
    expect(amountFromNumber(0).warning).toContain('zero');
    expect([cellColumn(0), cellColumn(25), cellColumn(26), cellColumn(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
  });
  it('validates OFX dates, amounts and entities', () => {
    expect(ofxDate('20261001').value).toBe('2026-10-01');
    expect(ofxDate('20261001235959.123[-03:00:BRT]').value).toBe('2026-10-01');
    expect(ofxDate('20261001246000').value).toBeNull();
    expect(ofxDate('2026-10-01').warning).toContain('inválida');
    expect(ofxDate('20261301').warning).toContain('inexistente');
    expect(ofxDate('').warning).toContain('ausente');
    expect(ofxAmount('-10,5').value).toBe('-10.50'); expect(ofxAmount('+1.2500').value).toBe('1.25'); expect(ofxAmount('0007.00').value).toBe('7.00');
    expect(ofxAmount('1.234').warning).toContain('duas casas'); expect(ofxAmount('1e3').warning).toContain('inválido');
    expect(ofxAmount('').warning).toContain('ausente'); expect(ofxAmount('0.00').warning).toContain('zero');
    expect(ofxValue('<NAME>A &amp; B &#233; &#x41; &bogus; &#0;', 'NAME')).toBe('A & B é A &bogus; &#0;');
  });
  it('decodes UTF-8, UTF-16 and explicit legacy charsets', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ text: 'A', encoding: 'UTF-8 com BOM', warnings: [] });
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))!.encoding).toBe('UTF-16 BE');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xff]))).toBeNull();
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toMatchObject({ text: 'café', encoding: 'ISO-8859-1 (Latin-1)' });
    expect(decodeText(new Uint8Array([0x80]))).toMatchObject({ text: '€', encoding: 'Windows-1252' });
    expect(decodeText(new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?>é').map(byte => byte === 0xc3 ? 0x20 : byte === 0xa9 ? 0xe9 : byte))!.warnings[0]).toContain('declarado');
    expect(declaredCharset(new TextEncoder().encode('OFXHEADER:100\nCHARSET:1252\n'))).toBe('windows-1252');
    expect(declaredCharset(new TextEncoder().encode('CHARSET:EBCDIC'))).toBeNull();
    expect(declaredCharset(new TextEncoder().encode('sem declaração'))).toBeNull();
  });
});
