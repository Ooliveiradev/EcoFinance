import { describe, expect, it } from 'vitest';
import { formatCurrency } from './utils';

describe('formatCurrency', () => {
  it('formats signed BRL amounts for presentation', () => {
    expect(formatCurrency(1234.56).replace(/\s/g, '')).toBe('R$1.234,56');
    expect(formatCurrency(-42.9).replace(/\s/g, '')).toBe('-R$42,90');
  });
});
