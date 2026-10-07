import { describe, it, expect } from 'vitest';
import { metricsReport, monthProjection, metricsCsv, metricsQuerySchema, monthsBetween, basisAmount, type MetricsEntry, type MetricsInput } from './metrics';
import { monthTotals, decimalCents } from './manual-finance';
import { planningSummary } from './planning';

const account = '10000000-0000-4000-8000-000000000001', food = 'food', rent = 'rent', card = 'card', salary = 'salary';
const row = (amount: string, kind: string, competenceMonth: string, extra: Partial<MetricsEntry> = {}): MetricsEntry =>
  ({ accountId: account, categoryId: food, amount, kind, status: 'settled', competenceMonth, paidDate: competenceMonth.slice(0, 8) + '05', archivedAt: null, ...extra });
// Known dataset: transfers, card purchase in installments, refund, invoice payment,
// recurrence, planned entry, archived/cancelled noise and months without movements.
const entries: MetricsEntry[] = [
  row('4000.00', 'income', '2026-09-01', { categoryId: salary }),
  row('-200.00', 'expense', '2026-09-01'),
  row('-60.00', 'expense', '2026-09-01', { paidDate: '2026-10-01' }),
  row('5000.00', 'income', '2026-10-01', { categoryId: salary }),
  row('-1000.00', 'transfer', '2026-10-01'), row('1000.00', 'transfer', '2026-10-01'),
  row('-1500.00', 'expense', '2026-10-01', { categoryId: rent, recurrenceOccurrenceId: 'occ-rent', paidDate: '2026-10-10' }),
  ...['10', '11', '12'].map(m => row('-100.00', 'expense', `2026-${m}-01`, { id: 'inst-' + m, installmentId: 'inst-' + m, status: 'recorded', paidDate: null })),
  row('40.00', 'refund', '2026-10-01', { refundOfId: 'inst-10', status: 'recorded', paidDate: null }),
  row('-100.00', 'adjustment', '2026-10-01', { categoryId: card, paidDate: '2026-10-20' }),
  row('-0.10', 'expense', '2026-10-01'), row('-0.20', 'expense', '2026-10-01'),
  row('-50.00', 'expense', '2026-10-01', { status: 'planned', paidDate: null }),
  row('-999.00', 'expense', '2026-10-01', { archivedAt: new Date() }),
  row('-77.00', 'expense', '2026-10-01', { status: 'cancelled', paidDate: null }),
];
const input: MetricsInput = {
  entries,
  occurrences: [
    { amount: '1500.00', status: 'paid', categoryId: rent, competenceMonth: '2026-10-01' },
    { amount: '120.00', status: 'pending', categoryId: rent, competenceMonth: '2026-10-01' },
    { amount: '30.00', status: 'postponed', categoryId: rent, competenceMonth: '2026-10-01' },
    { amount: '80.00', status: 'pending', categoryId: rent, competenceMonth: '2026-11-01' },
  ],
  plans: new Map([['2026-10', { limit: '2000.00', expectedIncome: '6000.00', reserve: '0.00', categories: [] }]]),
  categories: [{ id: food, name: 'Mercado', color: '#22aa66' }, { id: rent, name: 'Moradia', color: '#aa2266' }],
  invoices: [
    { competenceMonth: '2026-10-01', remaining: '60.00', paid: false },
    { competenceMonth: '2026-10-01', remaining: '-5.00', paid: false },
    { competenceMonth: '2026-10-01', remaining: '10.00', paid: true },
    { competenceMonth: '2026-11-01', remaining: '100.00', paid: false },
  ],
};

describe('metrics query', () => {
  it('lists inclusive months across years and validates the period', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2026-11', '2026-10')).toEqual([]);
    expect(monthsBetween('2026-13', '2027-01')).toEqual([]);
    expect(metricsQuerySchema.parse({ from: '2026-01', to: '2026-12' })).toEqual({ from: '2026-01', to: '2026-12', basis: 'competence' });
    expect(metricsQuerySchema.safeParse({ from: '2026-01', to: '2027-01' }).success).toBe(false);
    expect(metricsQuerySchema.safeParse({ from: '2026-02', to: '2026-01' }).success).toBe(false);
    expect(metricsQuerySchema.safeParse({ from: '2026-01', to: '2026-01', basis: 'other' }).success).toBe(false);
    expect(metricsQuerySchema.safeParse({ from: '2026-01', to: '2026-01', ownerId: 'x' }).success).toBe(false);
  });
});

describe('competence and cash totals', () => {
  it('adds cents exactly', () => {
    const report = metricsReport({ ...input, entries: [row('-0.10', 'expense', '2026-10-01'), row('-0.20', 'expense', '2026-10-01')] }, { from: '2026-10', to: '2026-10', basis: 'competence' });
    expect(report.totals.expenses).toBe('0.30');
  });
  it('counts card purchases by competence, excludes transfers, payments and opening balances', () => {
    const report = metricsReport(input, { from: '2026-10', to: '2026-10', basis: 'competence' });
    expect(report.months[0]).toMatchObject({ income: '5000.00', expenses: '1560.30', net: '3439.70', fixed: '1560.00', variable: '0.30', count: 6 });
    // Same rule as the existing monthly summary and the planning budget.
    expect(report.months[0]!.expenses).toBe(decimalCents(monthTotals(entries, '2026-10').expenses));
    expect(report.months[0]!.income).toBe(decimalCents(monthTotals(entries, '2026-10').income));
    expect(report.categories).toEqual([
      { id: rent, name: 'Moradia', color: '#aa2266', amount: '1500.00', share: '96.1' },
      { id: food, name: 'Mercado', color: '#22aa66', amount: '60.30', share: '3.9' },
    ]);
  });
  it('uses payment dates for cash, including invoice payments but never transfers', () => {
    const report = metricsReport(input, { from: '2026-10', to: '2026-10', basis: 'cash' });
    expect(report.months[0]).toMatchObject({ income: '5000.00', expenses: '1660.30', count: 6 });
    expect(report.categories.map(c => [c.name, c.amount])).toEqual([['Moradia', '1500.00'], ['Categoria histórica', '100.00'], ['Mercado', '60.30']]);
    expect(basisAmount(row('-5.00', 'expense', '2026-10-01', { paidDate: null }), '2026-10', 'cash')).toBeNull();
    expect(basisAmount(row('-5.00', 'adjustment', '2026-10-01'), '2026-10', 'competence')).toBeNull();
  });
  it('drops categories netted to zero and never reports negative shares', () => {
    const report = metricsReport({ ...input, entries: [row('-10.00', 'expense', '2026-10-01'), row('10.00', 'refund', '2026-10-01'), row('5.00', 'refund', '2026-10-01', { categoryId: rent })] }, { from: '2026-10', to: '2026-10', basis: 'competence' });
    expect(report.totals.expenses).toBe('-5.00');
    expect(report.categories).toEqual([{ id: rent, name: 'Moradia', color: '#aa2266', amount: '-5.00', share: '0.0' }]);
  });
});

describe('evolution and trend', () => {
  it('compares against the previous month only when it has movements', () => {
    const report = metricsReport(input, { from: '2026-10', to: '2027-02', basis: 'competence' });
    expect(report.months.map(m => [m.month, m.expenses, m.count])).toEqual([['2026-10', '1560.30', 6], ['2026-11', '100.00', 1], ['2026-12', '100.00', 1], ['2027-01', '0.00', 0], ['2027-02', '0.00', 0]]);
    expect(report.months[0]!.trend.income).toMatchObject({ direction: 'up', short: '+25,0%' });
    expect(report.months[1]!.trend.income).toMatchObject({ direction: 'down', short: '−100,0%' });
    expect(report.months[2]!.trend.expenses.direction).toBe('flat');
    expect(report.months[4]!.trend.expenses).toMatchObject({ direction: 'unknown', label: 'Sem mês anterior para comparar' });
    expect(report.totals).toMatchObject({ income: '5000.00', expenses: '1760.30', count: 8 });
    expect(metricsReport(input, { from: '2026-09', to: '2026-09', basis: 'competence' }).months[0]!.trend.income.direction).toBe('unknown');
    expect(metricsReport(input, { from: '2000-01', to: '2000-01', basis: 'cash' }).months[0]!.trend.income.direction).toBe('unknown');
  });
});

describe('planned versus realized and projection', () => {
  it('reuses the budget rule and reports months without a budget as such', () => {
    const report = metricsReport(input, { from: '2026-10', to: '2026-11', basis: 'cash' });
    const expected = planningSummary(entries, input.occurrences.filter(o => o.competenceMonth === '2026-10-01'), '2026-10', input.plans.get('2026-10')!).summary;
    expect(report.plan[0]).toEqual({ month: '2026-10', planned: true, limit: '2000.00', expectedIncome: '6000.00', realized: expected.realized, pending: expected.pending, committed: expected.committed, remaining: expected.remaining });
    expect(report.plan[0]).toMatchObject({ realized: '1560.30', pending: '150.00', remaining: '289.70' });
    expect(report.plan[1]).toEqual({ month: '2026-11', planned: false, limit: null, expectedIncome: null, realized: '100.00', pending: '80.00', committed: '180.00', remaining: null });
  });
  it('projects availability without counting paid commitments twice', () => {
    const projection = monthProjection(input, '2026-10', 300000n);
    expect(projection).toEqual({
      received: '5000.00', expectedIncome: '6000.00', toReceive: '1000.00', realized: '1560.30',
      commitments: { recurring: '150.00', planned: '50.00', invoices: '60.00', total: '260.00' },
      balance: '3000.00', projected: '3740.00',
      formula: 'saldo 3000.00 + a receber 1000.00 − compromissos 260.00 = 3740.00',
    });
  });
  it('keeps unknown balances and missing budgets explicit', () => {
    const projection = monthProjection(input, '2026-11', null);
    expect(projection).toMatchObject({ expectedIncome: null, toReceive: null, balance: null, projected: null });
    expect(projection.formula).toBe('saldo indisponível + a receber 0.00 (sem orçamento) − compromissos 180.00 = indisponível');
    expect(monthProjection({ ...input, plans: new Map([['2026-10', { limit: '0.00', expectedIncome: '100.00', reserve: '0.00', categories: [] }]]) }, '2026-10', 0n).toReceive).toBe('0.00');
  });
});

describe('CSV export', () => {
  it('exports the same values as the report and neutralizes formulas', () => {
    const report = metricsReport({ ...input, categories: [{ id: food, name: '=HYPERLINK("x");1', color: '#000000' }] }, { from: '2026-10', to: '2026-11', basis: 'competence' });
    const csv = metricsCsv(report), lines = csv.slice(1).trimEnd().split('\r\n');
    expect(csv.startsWith('﻿seção;período;base;item;valor\r\n')).toBe(true);
    expect(lines).toContain('mensal;2026-10;competência;expenses;1560.30');
    expect(lines).toContain('total;2026-10..2026-11;competência;net;3339.70');
    expect(lines).toContain('categoria;2026-10..2026-11;competência;"\'=HYPERLINK(""x"");1";160.30');
    expect(lines).toContain('orçamento;2026-10;competência;remaining;289.70');
    expect(lines).toContain('orçamento;2026-11;competência;sem orçamento;');
    const negative = metricsCsv(metricsReport({ ...input, entries: [row('-1.00', 'income', '2026-10-01')] }, { from: '2026-10', to: '2026-10', basis: 'cash' }));
    expect(negative).toContain('mensal;2026-10;caixa;net;-1.00');
    expect(negative).toContain('mensal;2026-10;caixa;expenses;1.00');
  });
});
