import { describe, expect, it } from 'vitest';
import { parseOfxContent } from './ofx-parser';

const transaction = (extra = '') => `<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261002120000[-03:BRT]</DTPOSTED><TRNAMT>-1,234.56</TRNAMT><FITID>synthetic-1</FITID>${extra}</STMTTRN>`;
describe('OFX parsing with synthetic financial data', () => {
  it('reads XML account metadata, signed amounts and timezone without shifting the source date', () => {
    const result = parseOfxContent(`<OFX><BANKID>synthetic-bank</BANKID><ACCTID>synthetic-account</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE><CURDEF>USD</CURDEF>${transaction('<NAME>Compra sintética</NAME><MEMO>Nota</MEMO>')}<LEDGERBAL><BALAMT>100.10</BALAMT><DTASOF>20261002</DTASOF></LEDGERBAL></OFX>`);
    expect(result).toMatchObject({ bankId: 'synthetic-bank', accountId: 'synthetic-account', accountType: 'SAVINGS', currency: 'USD', balanceAmount: 100.1, balanceDate: '2026-10-02T00:00:00Z' });
    expect(result.transactions).toEqual([{ fitId: 'synthetic-1', type: 'DEBIT', datePosted: '2026-10-02T12:00:00-03:00', amount: -1234.56, name: 'Compra sintética', memo: 'Nota' }]);
  });
  it('reads SGML with CRLF and defaults missing optional metadata', () => {
    const result = parseOfxContent('<OFX>\r\n<STMTTRN>\r\n<DTPOSTED>20261002\r\n<TRNAMT>42.90\r\n<FITID>synthetic-2\r\n<MEMO>Somente memória\r\n</STMTTRN>\r\n</OFX>');
    expect(result).toMatchObject({ currency: 'BRL', accountType: 'CHECKING', balanceAmount: null });
    expect(result.transactions[0]).toMatchObject({ type: 'OTHER', amount: 42.9, name: 'Somente memória', datePosted: '2026-10-02T00:00:00Z' });
  });
  it('uses available balance when no ledger balance exists', () => {
    expect(parseOfxContent('<AVAILBAL><BALAMT>45.20</BALAMT><DTASOF>20261002120000.000[+00:UTC]</DTASOF></AVAILBAL>')).toMatchObject({ balanceAmount: 45.2, balanceDate: '2026-10-02T12:00:00+00:00' });
  });
  it('skips incomplete or nonnumeric transactions without dropping valid neighbors', () => {
    const invalid = '<STMTTRN><DTPOSTED>20261002</DTPOSTED><TRNAMT>invalid</TRNAMT><FITID>bad</FITID></STMTTRN><STMTTRN><TRNAMT>1</TRNAMT></STMTTRN>';
    expect(parseOfxContent(invalid + transaction()).transactions).toHaveLength(1);
    expect(parseOfxContent(transaction()).transactions[0]?.name).toBe('Sem descrição');
  });
  it('supports SGML transaction aggregates without closing tags', () => {
    const result = parseOfxContent('<STMTTRN>\n<DTPOSTED>20261002\n<TRNAMT>1\n<FITID>one\n<STMTTRN>\n<DTPOSTED>20261003\n<TRNAMT>-2\n<FITID>two\n');
    expect(result.transactions.map(item => item.fitId)).toEqual(['one', 'two']);
  });
  it('keeps missing and empty balance fields unset', () => {
    expect(parseOfxContent('<LEDGERBAL></LEDGERBAL><AVAILBAL></AVAILBAL>')).toMatchObject({ transactions: [], balanceAmount: null, balanceDate: null });
  });
  it('reads hour-only timestamps and a balance without a date', () => {
    const result = parseOfxContent('<STMTTRN><DTPOSTED>2026100212</DTPOSTED><TRNAMT>1</TRNAMT><FITID>hour-only</FITID></STMTTRN><LEDGERBAL><BALAMT>1</BALAMT></LEDGERBAL>');
    expect(result.transactions[0]?.datePosted).toBe('2026-10-02T12:00:00Z');
    expect(result.balanceDate).toBeNull();
  });
  it('reads minute timestamps and SGML balances', () => {
    expect(parseOfxContent('<AVAILBAL>\n<BALAMT>2.5\n<DTASOF>202610021230\n').balanceDate).toBe('2026-10-02T12:30:00Z');
  });
  it('rejects a truncated source date rather than inventing the current date', () => {
    expect(() => parseOfxContent('<STMTTRN><DTPOSTED>2026</DTPOSTED><TRNAMT>1</TRNAMT><FITID>truncated-date</FITID></STMTTRN>')).toThrow('Invalid OFX date');
  });
});
