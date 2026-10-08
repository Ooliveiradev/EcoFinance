import { manualEntrySchema, type ManualAccountRecord, type ManualCategoryRecord, type ManualEntry, type ManualEntryRecord } from '@ecofinance/shared';
import { absolute, fieldErrors, moneyInput, parseMoneyInput } from './format';
import type { Mutation } from './outbox';

/** Text state of the quick-entry form; also what is saved as a local draft. */
export interface EntryForm {
  kind: 'income' | 'expense' | 'transfer';
  description: string;
  amount: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  status: 'planned' | 'recorded' | 'settled';
  purchaseDate: string;
  /** YYYY-MM */
  month: string;
  paidDate: string;
  notes: string;
}
export const ENTRY_KINDS = [['expense', 'Despesa'], ['income', 'Receita'], ['transfer', 'Transferência']] as const;
export const ENTRY_STATUSES = [['settled', 'Pago'], ['recorded', 'Registrado'], ['planned', 'Previsto']] as const;

export function newEntryForm(today: string, month: string, accounts: ManualAccountRecord[], categories: ManualCategoryRecord[]): EntryForm {
  const account = accounts.find(row => !row.archivedAt), category = categories.find(row => !row.archivedAt);
  // A date inside the month being viewed, so the entry shows up where it was created.
  const purchaseDate = today.startsWith(month) ? today : month + '-01';
  return { kind: 'expense', description: '', amount: '', accountId: account?.id ?? '', toAccountId: '', categoryId: category?.id ?? '', status: 'settled', purchaseDate, month, paidDate: purchaseDate, notes: '' };
}
export function entryFormFrom(row: ManualEntryRecord): EntryForm {
  const transfer = row.kind === 'transfer';
  return {
    kind: transfer ? 'transfer' : row.kind === 'income' ? 'income' : 'expense',
    description: row.description, amount: moneyInput(absolute(row.amount)),
    accountId: transfer ? row.transferFromAccountId ?? row.accountId : row.accountId,
    toAccountId: transfer ? row.toAccountId ?? '' : '', categoryId: row.categoryId,
    status: row.status === 'cancelled' ? 'recorded' : row.status,
    purchaseDate: row.purchaseDate, month: row.competenceMonth.slice(0, 7),
    paidDate: row.paidDate ?? row.purchaseDate, notes: row.notes ?? '',
  };
}
/** Reopens a queued draft (already validated data) in the form. */
export function entryFormFromData(data: ManualEntry): EntryForm {
  return {
    kind: data.kind, description: data.description, amount: moneyInput(data.amount), accountId: data.accountId,
    toAccountId: data.toAccountId ?? '', categoryId: data.categoryId, status: data.status === 'cancelled' ? 'recorded' : data.status,
    purchaseDate: data.purchaseDate, month: data.competenceMonth.slice(0, 7), paidDate: data.paidDate ?? data.purchaseDate, notes: data.notes ?? '',
  };
}
/** Changing the purchase date moves competence and payment along, unless they were set apart on purpose. */
export function withPurchaseDate(form: EntryForm, purchaseDate: string): EntryForm {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(purchaseDate);
  return {
    ...form, purchaseDate,
    month: valid && form.month === form.purchaseDate.slice(0, 7) ? purchaseDate.slice(0, 7) : form.month,
    paidDate: form.paidDate === form.purchaseDate ? purchaseDate : form.paidDate,
  };
}
export type EntryValidation = { ok: true; data: ManualEntry } | { ok: false; errors: Record<string, string> };
/** The same shared schema the server applies; the form never sends what the server would refuse. */
export function validateEntry(form: EntryForm): EntryValidation {
  const amount = parseMoneyInput(form.amount);
  if (amount === null) return { ok: false, errors: { amount: 'Informe um valor como 12,34.' } };
  const parsed = manualEntrySchema.safeParse({
    accountId: form.accountId, categoryId: form.categoryId,
    toAccountId: form.kind === 'transfer' ? form.toAccountId || null : null,
    description: form.description, amount: absolute(amount), kind: form.kind, status: form.status,
    purchaseDate: form.purchaseDate, competenceMonth: form.month + '-01',
    dueDate: null, paidDate: form.status === 'settled' ? form.paidDate : null,
    notes: form.notes.trim() ? form.notes.trim() : null,
  });
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, errors: fieldErrors(parsed.error) };
}
export function saveEntryMutation(data: ManualEntry, existing: Pick<ManualEntryRecord, 'id' | 'revision'> | null): Mutation {
  const verb = existing ? 'Editar' : 'Novo lançamento';
  return {
    method: existing ? 'PATCH' : 'POST', path: existing ? `/api/entries/${existing.id}` : '/api/entries',
    body: data, ifMatch: existing?.revision ?? null, label: `${verb}: ${data.description}`,
    resource: existing ? { type: 'entry', id: existing.id } : null, kind: existing ? 'entry:update' : 'entry:create',
  };
}
export function archiveEntryMutation(row: Pick<ManualEntryRecord, 'id' | 'revision' | 'description'>, restore = false): Mutation {
  return {
    method: restore ? 'POST' : 'DELETE', path: `/api/entries/${row.id}`, body: { action: restore ? 'restore' : 'archive' },
    ifMatch: row.revision, label: `${restore ? 'Restaurar' : 'Excluir'}: ${row.description}`,
    resource: { type: 'entry', id: row.id }, kind: restore ? 'entry:restore' : 'entry:archive',
  };
}
