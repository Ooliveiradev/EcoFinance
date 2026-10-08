import { manualAccountSchema, manualCategorySchema, type ManualAccountRecord, type ManualCategoryRecord } from '@ecofinance/shared';
import { fieldErrors, moneyInput, parseMoneyInput } from './format';
import type { Mutation } from './outbox';

export interface AccountForm { name: string; type: 'banco' | 'carteira'; openingBalance: string; openingDate: string; color: string }
export interface CategoryForm { name: string; color: string; icon: string }
export const ACCOUNT_TYPES = [['banco', 'Banco'], ['carteira', 'Carteira']] as const;
export const PALETTE = [['#10b981', 'Verde'], ['#3b82f6', 'Azul'], ['#f59e0b', 'Âmbar'], ['#ef4444', 'Vermelho'], ['#8b5cf6', 'Roxo'], ['#64748b', 'Cinza']] as const;

export function accountForm(row: ManualAccountRecord | undefined, today: string): AccountForm {
  return row ? { name: row.name, type: row.type, openingBalance: row.openingBalance.startsWith('-') ? '-' + moneyInput(row.openingBalance) : moneyInput(row.openingBalance), openingDate: row.openingDate ?? today, color: row.color }
    : { name: '', type: 'banco', openingBalance: '0,00', openingDate: today, color: '#10b981' };
}
export function categoryForm(row: ManualCategoryRecord | undefined): CategoryForm {
  return row ? { name: row.name, color: row.color, icon: row.icon } : { name: '', color: '#10b981', icon: 'tag' };
}
type Built = { ok: true; mutation: Mutation } | { ok: false; errors: Record<string, string> };
/** Opening balance may be negative (an overdrawn account); the shared schema decides the rest. */
export function accountMutation(form: AccountForm, row: ManualAccountRecord | undefined): Built {
  const openingBalance = parseMoneyInput(form.openingBalance);
  if (openingBalance === null) return { ok: false, errors: { openingBalance: 'Informe um valor como 1.234,56.' } };
  const parsed = manualAccountSchema.safeParse({ name: form.name, type: form.type, openingBalance, openingDate: form.openingDate, color: form.color, sortOrder: row?.sortOrder ?? 0 });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, mutation: {
    method: row ? 'PATCH' : 'POST', path: row ? `/api/accounts/${row.id}` : '/api/accounts', body: parsed.data, ifMatch: row?.revision ?? null,
    label: `${row ? 'Editar conta' : 'Nova conta'}: ${parsed.data.name}`, resource: row ? { type: 'account', id: row.id } : null, kind: 'account:save',
  } };
}
export function categoryMutation(form: CategoryForm, row: ManualCategoryRecord | undefined): Built {
  const parsed = manualCategorySchema.safeParse({ name: form.name, color: form.color, icon: form.icon, sortOrder: row?.sortOrder ?? 0 });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, mutation: {
    method: row ? 'PATCH' : 'POST', path: row ? `/api/categories/${row.id}` : '/api/categories', body: parsed.data, ifMatch: row?.revision ?? null,
    label: `${row ? 'Editar categoria' : 'Nova categoria'}: ${parsed.data.name}`, resource: row ? { type: 'category', id: row.id } : null, kind: 'category:save',
  } };
}
export function archiveReferenceMutation(type: 'account' | 'category', row: { id: string; name: string; revision: string; archivedAt: string | null }): Mutation {
  const archive = !row.archivedAt, collection = type === 'account' ? 'accounts' : 'categories';
  return {
    method: 'POST', path: `/api/${collection}/${row.id}`, body: { action: archive ? 'archive' : 'restore' }, ifMatch: row.revision,
    label: `${archive ? 'Arquivar' : 'Restaurar'} ${type === 'account' ? 'conta' : 'categoria'}: ${row.name}`, resource: { type, id: row.id }, kind: `${type}:archive`,
  };
}
