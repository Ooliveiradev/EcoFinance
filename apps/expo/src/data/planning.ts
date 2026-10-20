import { budgetPlanSchema, paymentSchema, postponementSchema, ruleChangeSchema, type BudgetPlan, type PlanningOccurrence, type PlanningRule, type PlanningView } from '@ecofinance/shared';
import { fieldErrors, moneyInput, parseMoneyInput } from './format';
import type { Mutation } from './outbox';

type Built = { ok: true; mutation: Mutation } | { ok: false; errors: Record<string, string> };
/** `categories` maps a category id to its typed limit; an empty text means no limit for that category. */
export interface BudgetForm { limit: string; expectedIncome: string; reserve: string; categories: Record<string, string> }
export function budgetForm(plan: BudgetPlan | null): BudgetForm {
  if (!plan) return { limit: '', expectedIncome: '', reserve: '0,00', categories: {} };
  return {
    limit: moneyInput(plan.limit), expectedIncome: moneyInput(plan.expectedIncome), reserve: moneyInput(plan.reserve),
    categories: Object.fromEntries(plan.categories.map(row => [row.categoryId, moneyInput(row.limit)])),
  };
}
export const categoryField = (categoryId: string) => `category:${categoryId}`;
function amounts<K extends string>(form: Record<K, string>, keys: readonly K[]) {
  const values = {} as Record<K, string>, errors: Record<string, string> = {};
  for (const key of keys) {
    const value = parseMoneyInput(form[key]);
    if (value === null) errors[key] = 'Informe um valor como 1.234,56.';
    else values[key] = value;
  }
  return { values, errors };
}
/** Source of a reviewed copy; the server refuses it if the source plan changed after the preview was read. */
export interface CopySource { sourceMonth: string; sourceRevision: string }
/**
 * Saves the monthly totals and the per-category limits. With `copy`, the
 * reviewed values replace this month's plan through the copy action, which
 * also checks the source revision.
 */
export function budgetMutation(month: string, plan: PlanningView['plan'], form: BudgetForm, copy?: CopySource): Built {
  const { values, errors } = amounts(form, ['limit', 'expectedIncome', 'reserve'] as const);
  const categories: BudgetPlan['categories'] = [];
  for (const [categoryId, text] of Object.entries(form.categories)) {
    if (!text.trim()) continue;
    const limit = parseMoneyInput(text);
    if (limit === null) errors[categoryField(categoryId)] = 'Informe um valor como 1.234,56 ou deixe vazio.';
    else categories.push({ categoryId, limit });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const parsed = budgetPlanSchema.safeParse({ ...values, categories });
  if (!parsed.success) {
    const result: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const row = issue.path[0] === 'categories' && typeof issue.path[1] === 'number' ? categories[issue.path[1]] : undefined;
      if (row) result[categoryField(row.categoryId)] ??= issue.code === 'custom' ? issue.message : 'Valor inválido.';
    }
    return { ok: false, errors: { ...fieldErrors(parsed.error), ...result } };
  }
  const ifMatch = plan?.revision ?? 'new';
  if (copy) return { ok: true, mutation: {
    method: 'POST', path: `/api/planning/${month}/copy`, body: { ...copy, plan: parsed.data }, ifMatch,
    // A conflict here may come from the source plan too, so it is not re-applied over a new revision: discard and copy again.
    label: `Copiar orçamento de ${copy.sourceMonth} para ${month}`, resource: null, kind: 'planning:copy',
  } };
  return { ok: true, mutation: {
    method: 'PUT', path: `/api/planning/${month}`, body: parsed.data, ifMatch,
    label: `Orçamento de ${month}`, resource: { type: 'budget', month }, kind: 'planning:budget',
  } };
}
/** Closing keeps pending forecasts and blocks individual changes in the month until it is reopened. */
export function monthStateMutation(view: Pick<PlanningView, 'month' | 'closed' | 'monthRevision'>): Mutation {
  const action = view.closed ? 'reopen' : 'close';
  return {
    method: 'POST', path: `/api/planning/${view.month}/state`, body: { action }, ifMatch: view.monthRevision,
    label: `${view.closed ? 'Reabrir' : 'Fechar'} o mês ${view.month}`, resource: { type: 'month', month: view.month }, kind: `planning:${action}`,
  };
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
export interface RuleForm {
  description: string; amount: string; accountId: string; categoryId: string; dueDay: string;
  startDate: string; endDate: string; reminderDays: string; estimated: boolean; paused: boolean;
  /** Only for edits: the first month the new version applies to. Earlier months keep the old one. */
  fromMonth: string;
}
export function ruleForm(month: string, rule?: PlanningRule): RuleForm {
  if (!rule) return { description: '', amount: '', accountId: '', categoryId: '', dueDay: '10', startDate: month + '-01', endDate: '', reminderDays: '', estimated: false, paused: false, fromMonth: month };
  return {
    description: rule.description, amount: moneyInput(rule.amount), accountId: rule.accountId, categoryId: rule.categoryId,
    dueDay: String(rule.dueDay), startDate: rule.startDate, endDate: rule.endDate ?? '', reminderDays: rule.reminderDays === null ? '' : String(rule.reminderDays),
    estimated: rule.estimated, paused: rule.paused, fromMonth: month,
  };
}
const wholeNumber = (text: string) => /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
/**
 * New rules start in the viewed month or at their start date, whichever is later
 * (the server rejects a version before the start). An edit changes the rule
 * from `fromMonth` on; payments and per-occurrence adjustments are preserved.
 */
export function ruleMutation(month: string, form: RuleForm, rule?: PlanningRule): Built {
  const amount = parseMoneyInput(form.amount);
  if (amount === null) return { ok: false, errors: { amount: 'Informe um valor como 12,34.' } };
  const startMonth = form.startDate.slice(0, 7);
  const fromMonth = rule ? form.fromMonth.trim() : (startMonth > month ? startMonth : month);
  const parsed = ruleChangeSchema.safeParse({ fromMonth, schedule: {
    accountId: form.accountId, categoryId: form.categoryId, description: form.description, amount,
    startDate: form.startDate, endDate: form.endDate.trim() || null, dueDay: wholeNumber(form.dueDay), estimated: form.estimated,
    reminderDays: form.reminderDays.trim() === '' ? null : wholeNumber(form.reminderDays), paused: form.paused,
  } });
  if (!parsed.success) {
    // Schedule fields are nested: report them by their own names.
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path.at(-1) ?? 'form')] ??= issue.code === 'custom' ? issue.message : 'Revise este campo.';
    return { ok: false, errors };
  }
  if (rule && parsed.data.fromMonth < startMonth) return { ok: false, errors: { fromMonth: 'Escolha um mês igual ou posterior ao início da recorrência.' } };
  const description = parsed.data.schedule.description;
  if (rule) return { ok: true, mutation: {
    method: 'PATCH', path: `/api/recurrences/${rule.id}`, body: parsed.data, ifMatch: rule.revision,
    label: `${parsed.data.schedule.paused && !rule.paused ? 'Pausar' : 'Editar'} recorrência: ${description} (a partir de ${parsed.data.fromMonth})`,
    resource: { type: 'recurrence', id: rule.id, month }, kind: 'recurrence:update',
  } };
  return { ok: true, mutation: {
    method: 'POST', path: '/api/recurrences', body: parsed.data, ifMatch: null,
    label: `Nova recorrência: ${description}`, resource: null, kind: 'recurrence:create',
  } };
}
