import { describe, expect, it } from 'vitest';
import { categorizeTransaction, formatCurrency, generateDeduplicationHash, isWithinTimeWindow, parseAmountFromText } from './utils';

describe('legacy financial helpers', () => {
  it('distinguishes food delivery from transport', () => {
    expect(categorizeTransaction('Uber Eats')).toBe('comida');
    expect(categorizeTransaction('Uber viagem')).toBe('transporte');
    expect(categorizeTransaction('Sem estabelecimento identificado')).toBe('desconhecido');
  });

  it('parses BRL values without accepting incomplete numeric input', () => {
    expect(parseAmountFromText('R$ 1.234,56')).toBe(1234.56);
    expect(parseAmountFromText('-42,90')).toBe(-42.9);
    expect(parseAmountFromText('1234,56')).toBe(1234.56);
    expect(parseAmountFromText('1234.56')).toBe(1234.56);
    expect(parseAmountFromText('R$ ')).toBeNull();
    for (const input of ['', '42abc', '1,234', '1.234,567', 'NaN', 'Infinity']) {
      expect(parseAmountFromText(input)).toBeNull();
    }
  });

  it('checks time-window boundaries and rejects invalid dates', () => {
    expect(isWithinTimeWindow('2026-10-02T12:00:00Z', '2026-10-02T12:05:00Z')).toBe(true);
    expect(isWithinTimeWindow('2026-10-02T12:00:00Z', '2026-10-02T12:05:01Z')).toBe(false);
    expect(isWithinTimeWindow('invalid', '2026-10-02T12:00:00Z')).toBe(false);
    expect(isWithinTimeWindow(new Date('2026-10-02T12:00:00Z'), new Date('2026-10-02T12:00:00Z'), 0)).toBe(true);
    expect(isWithinTimeWindow('2026-10-02T12:00:00Z', 'invalid')).toBe(false);
  });

  it('formats signed BRL amounts for presentation', () => {
    expect(formatCurrency(1234.56).replace(/\s/g, '')).toBe('R$1.234,56');
    expect(formatCurrency(-42.9).replace(/\s/g, '')).toBe('-R$42,90');
  });

  it('makes the legacy event hash stable without treating it as cross-source deduplication', async () => {
    const hash = await generateDeduplicationHash(42.9, ' Banco Exemplo ', '2026-10-02T12:00:00Z');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await generateDeduplicationHash(42.9, 'banco exemplo', '2026-10-02T12:00:00Z')).toBe(hash);
    expect(await generateDeduplicationHash(42.9, 'banco exemplo', '2026-10-02T12:00:01Z')).not.toBe(hash);
  });
});
