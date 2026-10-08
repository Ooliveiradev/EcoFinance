import { budgetPlanSchema, paymentSchema, postponementSchema, ruleChangeSchema, type PlanningOccurrence, type PlanningView } from '@ecofinance/shared';
import { fieldErrors, moneyInput, parseMoneyInput } from './format';
import type { Mutation } from './outbox';

type Built = { ok: true; mutation: Mutation } | { ok: false; errors: Record<string, string> };
export interface BudgetForm { limit: string; expectedIncome: string; reserve: string }
export function budgetForm(plan: PlanningView['plan']): BudgetForm {
  return plan ? { limit: moneyInput(plan.limit), expectedIncome: moneyInput(plan.expectedIncome), reserve: moneyInput(plan.reserve) } : { limit: '', expectedIncome: '', reserve: '0,00' };
}
function amounts<K extends string>(form: Record<K, string>, keys: readonly K[]) {
  const values = {} as Record<K, string>, errors: Record<string, string> = {};
  for (const key of keys) {
    const value = parseMoneyInput(form[key]);
    if (value === null) errors[key] = 'Informe um valor como 1.234,56.';
    else values[key] = value;
  }
  return { values, errors };
}
/** Category limits set on the web are kept as they are; the phone edits the monthly totals. */
export function budgetMutation(month: string, plan: PlanningView['plan'], form: BudgetForm): Built {
  const { values, errors } = amounts(form, ['limit', 'expectedIncome', 'reserve'] as const);
  if (Object.keys(errors).length) return { ok: false, errors };
  const parsed = budgetPlanSchema.safeParse({ ...values, categories: plan?.categories ?? [] });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, mutation: {
    method: 'PUT', path: `/api/planning/${month}`, body: parsed.data, ifMatch: plan?.revision ?? 'new',
    label: `Orçamento de ${month}`, resource: { type: 'budget', month }, kind: 'planning:budget',
  } };
}
export type OccurrenceAction = 'pay' | 'postpone' | 'cancel' | 'restore';
const ACTION_LABEL: Record<OccurrenceAction, string> = { pay: 'Pagar', postpone: 'Adiar', cancel: 'Cancelar', restore: 'Restaurar' };
export function occurrenceMutation(occurrence: PlanningOccurrence, month: string, action: OccurrenceAction, input: { amount?: string; date?: string } = {}): Built {
  let body: unknown = {};
  if (action === 'pay') {
    const amount = parseMoneyInput(input.amount ?? '');
    if (amount === null) return { ok: false, errors: { amount: 'Informe um valor como 12,34.' } };
    const parsed = paymentSchema.safeParse({ amount, paidDate: input.date });
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
    body = parsed.data;
  }
  if (action === 'postpone') {
    const parsed = postponementSchema.safeParse({ dueDate: input.date });
    if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
    body = parsed.data;
  }
  return { ok: true, mutation: {
    method: 'POST', path: `/api/occurrences/${occurrence.id}/${action}`, body, ifMatch: occurrence.revision,
    label: `${ACTION_LABEL[action]}: ${occurrence.description}`, resource: { type: 'occurrence', id: occurrence.id, month }, kind: `occurrence:${action}`,
  } };
}
export function generateMutation(month: string): Mutation {
  return { method: 'POST', path: `/api/planning/${month}/generate`, body: {}, ifMatch: null, label: `Gerar previstos de ${month}`, resource: null, kind: 'planning:generate' };
}
export interface RuleForm { description: string; amount: string; accountId: string; categoryId: string; dueDay: string; startDate: string; estimated: boolean }
export function ruleMutation(month: string, form: RuleForm): Built {
  const amount = parseMoneyInput(form.amount);
  if (amount === null) return { ok: false, errors: { amount: 'Informe um valor como 12,34.' } };
  const parsed = ruleChangeSchema.safeParse({ fromMonth: month, schedule: {
    accountId: form.accountId, categoryId: form.categoryId, description: form.description, amount,
    startDate: form.startDate, endDate: null, dueDay: Number(form.dueDay), estimated: form.estimated, reminderDays: null, paused: false,
  } });
  if (!parsed.success) {
    // Schedule fields are nested: report them by their own names.
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path.at(-1) ?? 'form')] ??= issue.code === 'custom' ? issue.message : 'Revise este campo.';
    return { ok: false, errors };
  }
  return { ok: true, mutation: {
    method: 'POST', path: '/api/recurrences', body: parsed.data, ifMatch: null,
    label: `Nova recorrência: ${parsed.data.schedule.description}`, resource: null, kind: 'recurrence:create',
  } };
}
