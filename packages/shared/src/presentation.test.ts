import { describe, expect, it } from 'vitest';
import { describeDue, SOON_THRESHOLD_DAYS } from './bills';
import { describeTrend, percentChange } from './trend';
import { categoryLabel, isTransactionCategory, TRANSACTION_CATEGORY_OPTIONS } from './category-labels';
import { formatBRL } from './finance';

describe('describeDue', () => {
  const today = '2026-10-05';

  it('classifies overdue, today, tomorrow, soon and upcoming bills with text labels', () => {
    expect(describeDue('2026-10-04', today)).toEqual({ state: 'overdue', days: -1, label: 'Atrasada há 1 dia' });
    expect(describeDue('2026-09-30', today)).toEqual({ state: 'overdue', days: -5, label: 'Atrasada há 5 dias' });
    expect(describeDue('2026-10-05', today)).toEqual({ state: 'today', days: 0, label: 'Vence hoje' });
    expect(describeDue('2026-10-06', today)).toEqual({ state: 'soon', days: 1, label: 'Vence amanhã' });
    expect(describeDue('2026-10-08', today)).toEqual({ state: 'soon', days: 3, label: 'Vence em 3 dias' });
    expect(describeDue('2026-10-09', today)).toEqual({ state: 'upcoming', days: 4, label: 'Vence em 4 dias' });
  });

  it('honours a custom threshold and exposes the default', () => {
    expect(SOON_THRESHOLD_DAYS).toBe(3);
    expect(describeDue('2026-10-09', today, 7)?.state).toBe('soon');
    expect(describeDue('2026-10-20', today, 7)?.state).toBe('upcoming');
  });

  it('handles the month boundary and invalid dates', () => {
    expect(describeDue('2026-11-01', '2026-10-31')?.label).toBe('Vence amanhã');
    expect(describeDue('2026-02-30', today)).toBeNull();
    expect(describeDue('2026-10-05', 'hoje')).toBeNull();
  });
});

describe('percentChange', () => {
  it('computes the change against the previous value', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
  });

  it('uses the absolute previous value so a negative baseline keeps its direction', () => {
    expect(percentChange(-50, -100)).toBe(50);
  });

  it('refuses to invent a trend without a usable baseline', () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(Number.NaN, 5)).toBeNull();
    expect(percentChange(5, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('describeTrend', () => {
  it('describes increases and decreases in words and symbols', () => {
    expect(describeTrend(12.46)).toEqual({
      direction: 'up',
      percent: 12.5,
      label: 'Aumento de 12,5% em relação ao mês anterior',
      short: '+12,5%',
    });
    expect(describeTrend(-3)).toEqual({
      direction: 'down',
      percent: -3,
      label: 'Queda de 3,0% em relação ao mês anterior',
      short: '−3,0%',
    });
  });

  it('treats rounding-to-zero as flat', () => {
    expect(describeTrend(0.04)).toMatchObject({ direction: 'flat', percent: 0, short: '0,0%' });
    expect(describeTrend(0)).toMatchObject({ direction: 'flat' });
  });

  it('reports missing baselines explicitly', () => {
    const unknown = { direction: 'unknown', percent: null, label: 'Sem mês anterior para comparar', short: '—' };
    expect(describeTrend(null)).toEqual(unknown);
    expect(describeTrend(Number.NaN)).toEqual(unknown);
  });
});

describe('category labels', () => {
  it('maps known keys and leaves unknown keys untouched', () => {
    expect(categoryLabel('comida')).toBe('Alimentação');
    expect(categoryLabel('desconhecido')).toBe('Outros');
    expect(categoryLabel('mercado-livre')).toBe('mercado-livre');
    expect(categoryLabel('constructor')).toBe('constructor');
  });

  it('guards the type and lists every category once', () => {
    expect(isTransactionCategory('lazer')).toBe(true);
    expect(isTransactionCategory('toString')).toBe(false);
    expect(isTransactionCategory(42)).toBe(false);
    expect(TRANSACTION_CATEGORY_OPTIONS).toHaveLength(11);
    expect(new Set(TRANSACTION_CATEGORY_OPTIONS.map(option => option.value)).size).toBe(11);
  });
});

describe('formatBRL', () => {
  it('formats positive and negative amounts with Brazilian Real convention', () => {
    const formattedPositive = formatBRL(1234.56);
    expect(formattedPositive).toContain('1.234,56');
    expect(formattedPositive).toContain('R$');

    const formattedNegative = formatBRL(-50.0);
    expect(formattedNegative).toContain('50,00');
  });
});
