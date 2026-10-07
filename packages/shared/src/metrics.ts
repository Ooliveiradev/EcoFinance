// =============================================================================
// Monthly metrics and reports
// =============================================================================
// One deterministic aggregation shared by the dashboard, the reports page, the
// CSV export and the API consumed by mobile. Every total is computed in integer
// cents and serialized as an exact decimal string; numbers exist only for chart
// geometry and trend percentages.
//
// Competência: recorded/settled income, expenses and refunds of the competence
// month. Card purchases count here; invoice payments (adjustments) and
// transfers do not, so a card purchase is never counted twice.
// Caixa: settled movements whose payment date falls in the month, transfers
// excluded. Invoice payments are real cash outflows here.
// Opening balances never become income. Planned entries and pending recurrence
// occurrences are commitments, never realized amounts.
// =============================================================================

import { z } from 'zod';
import { moneyToCents } from './finance';
import { isMonthParam, shiftMonth } from './month';
import { decimalCents, type SummaryEntry } from './manual-finance';
import { planningSummary, type BudgetPlan, type PlanningOccurrence } from './planning';
import { describeTrend, percentChange, type TrendDescription } from './trend';

export const METRICS_MAX_MONTHS = 12;
export const metricsBasisSchema = z.enum(['competence', 'cash']);
export type MetricsBasis = z.infer<typeof metricsBasisSchema>;
const monthParam = z.string().refine(isMonthParam, 'Escolha um mês entre 2000 e 2100.');
export const metricsQuerySchema = z.object({
  from: monthParam, to: monthParam, basis: metricsBasisSchema.default('competence'),
}).strict().superRefine((query, context) => {
  const months = monthsBetween(query.from, query.to);
  if (!months.length) context.addIssue({ code: 'custom', path: ['to'], message: 'O mês final deve ser igual ou posterior ao inicial.' });
  else if (months.length > METRICS_MAX_MONTHS) context.addIssue({ code: 'custom', path: ['to'], message: `Escolha no máximo ${METRICS_MAX_MONTHS} meses.` });
});
export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

export interface MetricsEntry extends SummaryEntry {
  id?: string;
  categoryId: string;
  recurrenceOccurrenceId?: string | null;
  installmentId?: string | null;
  /** A refund follows the fixed/variable classification of the expense it reverses. */
  refundOfId?: string | null;
}
export interface MetricsOccurrence { amount: string; status: PlanningOccurrence['status']; categoryId: string; competenceMonth: string }
export interface MetricsCategory { id: string; name: string; color: string }
export interface MetricsInvoice { competenceMonth: string; remaining: string; paid: boolean }
export interface MetricsInput {
  entries: MetricsEntry[];
  occurrences: MetricsOccurrence[];
  /** Budget plans keyed by month (YYYY-MM). A missing month means "sem orçamento". */
  plans: Map<string, BudgetPlan>;
  categories: MetricsCategory[];
  invoices: MetricsInvoice[];
}

/** Inclusive list of YYYY-MM months; empty when `to` precedes `from` or a bound is invalid. */
export function monthsBetween(from: string, to: string): string[] {
  if (!isMonthParam(from) || !isMonthParam(to) || to < from) return [];
  const months = [from];
  while (months[months.length - 1]! < to && months.length <= METRICS_MAX_MONTHS) months.push(shiftMonth(months[months.length - 1]!, 1)!);
  return months;
}

const realizedStatus = (status: string) => status === 'recorded' || status === 'settled';
const pendingStatus = (status: string) => status === 'pending' || status === 'postponed';
const isFixed = (entry: MetricsEntry) => !!entry.recurrenceOccurrenceId || !!entry.installmentId;
function fixedIds(entries: MetricsEntry[]) {
  return new Set(entries.filter(entry => entry.id && isFixed(entry)).map(entry => entry.id!));
}

/** Signed cents an entry contributes to the month in the chosen basis, or null when it does not count. */
export function basisAmount(entry: MetricsEntry, month: string, basis: MetricsBasis): bigint | null {
  if (entry.archivedAt != null || entry.kind === 'transfer') return null;
  if (basis === 'competence') {
    if (entry.competenceMonth !== month + '-01' || !realizedStatus(entry.status)) return null;
    return ['income', 'expense', 'refund'].includes(entry.kind) ? moneyToCents(entry.amount) : null;
  }
  if (entry.status !== 'settled' || !entry.paidDate || entry.paidDate.slice(0, 7) !== month) return null;
  return moneyToCents(entry.amount);
}

interface MonthAccumulator { income: bigint; expenses: bigint; fixed: bigint; variable: bigint; count: number; categories: Map<string, bigint> }
function accumulate(entries: MetricsEntry[], month: string, basis: MetricsBasis, fixed = fixedIds(entries)): MonthAccumulator {
  const result: MonthAccumulator = { income: 0n, expenses: 0n, fixed: 0n, variable: 0n, count: 0, categories: new Map() };
  for (const entry of entries) {
    const cents = basisAmount(entry, month, basis);
    if (cents === null) continue;
    result.count++;
    // Competence income is the explicit kind; a refund reduces expenses where
    // it belongs. Cash uses the movement direction.
    const income = basis === 'competence' ? entry.kind === 'income' : cents > 0n;
    if (income) { result.income += cents; continue; }
    const spent = -cents;
    result.expenses += spent;
    if (isFixed(entry) || (entry.refundOfId && fixed.has(entry.refundOfId))) result.fixed += spent; else result.variable += spent;
    result.categories.set(entry.categoryId, (result.categories.get(entry.categoryId) ?? 0n) + spent);
  }
  return result;
}

const chartNumber = (cents: bigint) => Number(cents) / 100;
function trend(current: bigint, previous: bigint, hasBaseline: boolean): TrendDescription {
  return describeTrend(hasBaseline ? percentChange(chartNumber(current), chartNumber(previous)) : null);
}
function share(part: bigint, total: bigint): string {
  if (total <= 0n || part <= 0n) return '0.0';
  const tenths = (part * 1000n + total / 2n) / total;
  return `${tenths / 10n}.${tenths % 10n}`;
}

export interface MetricsMonthRow {
  month: string; income: string; expenses: string; net: string; fixed: string; variable: string; count: number;
  trend: { income: TrendDescription; expenses: TrendDescription };
}
export interface MetricsPlanRow {
  month: string; planned: boolean; limit: string | null; expectedIncome: string | null;
  realized: string; pending: string; committed: string; remaining: string | null;
}
export interface MetricsReport {
  from: string; to: string; basis: MetricsBasis;
  months: MetricsMonthRow[];
  totals: { income: string; expenses: string; net: string; fixed: string; variable: string; count: number };
  categories: { id: string; name: string; color: string; amount: string; share: string }[];
  plan: MetricsPlanRow[];
}

/** Builds every table, chart and export of a period from the same totals. */
export function metricsReport(input: MetricsInput, query: MetricsQuery): MetricsReport {
  const { from, to, basis } = metricsQuerySchema.parse(query);
  const months = monthsBetween(from, to);
  const before = shiftMonth(from, -1), fixed = fixedIds(input.entries);
  let previous = before ? accumulate(input.entries, before, basis, fixed) : accumulate([], from, basis);
  const totals = { income: 0n, expenses: 0n, fixed: 0n, variable: 0n, count: 0 };
  const categories = new Map<string, bigint>();
  const rows: MetricsMonthRow[] = [];
  for (const month of months) {
    const current = accumulate(input.entries, month, basis, fixed), baseline = previous.count > 0;
    rows.push({
      month, income: decimalCents(current.income), expenses: decimalCents(current.expenses),
      net: decimalCents(current.income - current.expenses), fixed: decimalCents(current.fixed),
      variable: decimalCents(current.variable), count: current.count,
      trend: { income: trend(current.income, previous.income, baseline), expenses: trend(current.expenses, previous.expenses, baseline) },
    });
    totals.income += current.income; totals.expenses += current.expenses;
    totals.fixed += current.fixed; totals.variable += current.variable; totals.count += current.count;
    for (const [id, cents] of current.categories) categories.set(id, (categories.get(id) ?? 0n) + cents);
    previous = current;
  }
  const names = new Map(input.categories.map(category => [category.id, category]));
  return {
    from, to, basis, months: rows,
    totals: {
      income: decimalCents(totals.income), expenses: decimalCents(totals.expenses), net: decimalCents(totals.income - totals.expenses),
      fixed: decimalCents(totals.fixed), variable: decimalCents(totals.variable), count: totals.count,
    },
    categories: [...categories].filter(([, cents]) => cents !== 0n)
      .sort(([a, x], [b, y]) => (y > x ? 1 : y < x ? -1 : a.localeCompare(b)))
      .map(([id, cents]) => ({
        id, name: names.get(id)?.name ?? 'Categoria histórica', color: names.get(id)?.color ?? '#64748b',
        amount: decimalCents(cents), share: share(cents, totals.expenses),
      })),
    plan: months.map(month => planRow(input, month)),
  };
}

/** Planned versus realized always uses competence, the basis of the monthly budget. */
function planRow(input: MetricsInput, month: string): MetricsPlanRow {
  const plan = input.plans.get(month) ?? null;
  const occurrences = input.occurrences.filter(o => o.competenceMonth === month + '-01');
  const { summary } = planningSummary(input.entries, occurrences, month, plan ?? { limit: '0.00', expectedIncome: '0.00', reserve: '0.00', categories: [] });
  return {
    month, planned: plan !== null, limit: plan?.limit ?? null, expectedIncome: plan?.expectedIncome ?? null,
    realized: summary.realized, pending: summary.pending, committed: summary.committed, remaining: plan ? summary.remaining : null,
  };
}

export interface MonthProjection {
  received: string; expectedIncome: string | null; toReceive: string | null; realized: string;
  commitments: { recurring: string; planned: string; invoices: string; total: string };
  balance: string | null; projected: string | null; formula: string;
}

/**
 * Projected availability = current balance + income still expected − remaining commitments.
 * Commitments are pending recurrences, planned (not yet realized) expenses and the
 * open balance of the month's card invoices; paid amounts already left the balance.
 */
export function monthProjection(input: MetricsInput, month: string, balance: bigint | null): MonthProjection {
  const { income: received, expenses: realized } = accumulate(input.entries, month, 'competence');
  const plan = input.plans.get(month) ?? null;
  const expected = plan ? moneyToCents(plan.expectedIncome) : null;
  const toReceive = expected === null ? null : expected > received ? expected - received : 0n;
  const recurring = input.occurrences.filter(o => o.competenceMonth === month + '-01' && pendingStatus(o.status))
    .reduce((sum, o) => { const cents = moneyToCents(o.amount); return sum + (cents < 0n ? -cents : cents); }, 0n);
  const planned = input.entries.filter(e => e.archivedAt == null && e.status === 'planned' && e.competenceMonth === month + '-01' && e.kind === 'expense')
    .reduce((sum, e) => sum - moneyToCents(e.amount), 0n);
  const invoices = input.invoices.filter(i => i.competenceMonth === month + '-01' && !i.paid)
    .reduce((sum, i) => { const cents = moneyToCents(i.remaining); return sum + (cents > 0n ? cents : 0n); }, 0n);
  const total = recurring + planned + invoices;
  const projected = balance === null ? null : balance + (toReceive ?? 0n) - total;
  const money = (cents: bigint | null) => cents === null ? 'indisponível' : decimalCents(cents);
  return {
    received: decimalCents(received), expectedIncome: expected === null ? null : decimalCents(expected),
    toReceive: toReceive === null ? null : decimalCents(toReceive), realized: decimalCents(realized),
    commitments: { recurring: decimalCents(recurring), planned: decimalCents(planned), invoices: decimalCents(invoices), total: decimalCents(total) },
    balance: balance === null ? null : decimalCents(balance), projected: projected === null ? null : decimalCents(projected),
    formula: `saldo ${money(balance)} + a receber ${toReceive === null ? '0.00 (sem orçamento)' : decimalCents(toReceive)} − compromissos ${decimalCents(total)} = ${money(projected)}`,
  };
}

const CSV_FORMULA = /^[=+\-@\t\r]/;
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = CSV_FORMULA.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Exports exactly the report values in long format (one value per line), so each
 * table cell, chart point and card has one matching CSV line. Text cells cannot
 * start a spreadsheet formula.
 */
export function metricsCsv(report: MetricsReport): string {
  const basis = report.basis === 'competence' ? 'competência' : 'caixa', period = `${report.from}..${report.to}`;
  const totals = (scope: string, label: string, row: Omit<MetricsMonthRow, 'month' | 'trend'>) =>
    (['income', 'expenses', 'net', 'fixed', 'variable', 'count'] as const).map(key => [scope, label, basis, key, row[key]]);
  const lines: (string | number)[][] = [
    ['seção', 'período', 'base', 'item', 'valor'],
    ...report.months.flatMap(row => totals('mensal', row.month, row)),
    ...totals('total', period, report.totals),
    ...report.categories.map(row => ['categoria', period, basis, row.name, row.amount]),
    ...report.plan.flatMap(row => row.planned
      ? [['orçamento', row.month, 'competência', 'limit', row.limit!], ['orçamento', row.month, 'competência', 'expectedIncome', row.expectedIncome!],
        ['orçamento', row.month, 'competência', 'realized', row.realized], ['orçamento', row.month, 'competência', 'pending', row.pending],
        ['orçamento', row.month, 'competência', 'committed', row.committed], ['orçamento', row.month, 'competência', 'remaining', row.remaining!]]
      : [['orçamento', row.month, 'competência', 'sem orçamento', '']]),
  ];
  return '﻿' + lines.map(line => line.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
