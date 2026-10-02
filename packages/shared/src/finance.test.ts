import { describe, expect, it } from 'vitest';
import { centsToMoney, moneyToCents, moneySchema, isCivilDate, competenceSchema, financialEntrySchema } from './finance';

describe('exact financial contracts', () => {
  it('adds decimal money exactly across the supported range', () => {
    expect(centsToMoney(moneyToCents('0.10') + moneyToCents('0.20'))).toBe('0.30');
    expect(centsToMoney(moneyToCents('9999999999999.99'))).toBe('9999999999999.99');
    expect(moneySchema.parse('-0.00')).toBe('0.00');
    expect(moneySchema.parse('-42.9')).toBe('-42.90');
  });
  it('rejects overflow, implicit rounding, exponent notation and coercion', () => {
    for (const value of ['10000000000000.00', '0.001', '1e3', '42abc', 'NaN', ' 42.90', '01.00', '1,20']) expect(moneySchema.safeParse(value).success).toBe(false);
    expect(moneySchema.safeParse(42.9).success).toBe(false);
    expect(() => centsToMoney(1_000_000_000_000_000n)).toThrow();
  });
  it('validates civil calendars without timezone rollover', () => {
    for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '2026-12-31']) expect(isCivilDate(date)).toBe(true);
    for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '0000-01-01', '2026-01-01T00:00:00Z']) expect(isCivilDate(date)).toBe(false);
    expect(competenceSchema.safeParse('2026-10-01').success).toBe(true);
    expect(competenceSchema.safeParse('2026-10-02').success).toBe(false);
  });
  const id = '00000000-0000-4000-8000-000000000001';
  const entry = { ownerId: id, accountId: id, categoryId: id, description: 'Compra sintética', amount: '-42.90', currency: 'BRL', kind: 'expense', status: 'recorded', purchaseDate: '2026-10-02', competenceMonth: '2026-10-01', dueDate: null, paidDate: null, source: 'manual', externalId: null, invoiceId: null, installmentId: null, recurrenceOccurrenceId: null };
  it('requires explicit ownership, financial kind and real settlement date', () => {
    expect(financialEntrySchema.safeParse(entry).success).toBe(true);
    for (const changes of [{ ownerId: undefined }, { kind: 'unclassified' }, { amount: '0' }, { amount: '42.90' }, { amount: '1e3' }, { status: 'settled' }]) expect(financialEntrySchema.safeParse({ ...entry, ...changes }).success).toBe(false);
    expect(financialEntrySchema.safeParse({ ...entry, kind: 'transfer', amount: '-42.90' }).success).toBe(true);
    expect(financialEntrySchema.safeParse({ ...entry, kind: 'refund', amount: '10.00' }).success).toBe(true);
  });
});
