import { describe, expect, it } from 'vitest';
import type { ManualAccountRecord, ManualCategoryRecord, ManualEntryRecord } from '@ecofinance/shared';
import { archiveEntryMutation, entryFormFrom, newEntryForm, saveEntryMutation, validateEntry } from './entries';
import { decimalToCents, money, parseMoneyInput } from './format';

const ACCOUNT = '30000000-0000-4000-8000-000000000001', SAVINGS = '30000000-0000-4000-8000-000000000002';
const CATEGORY = '40000000-0000-4000-8000-000000000001';
const accounts = [{ id: ACCOUNT, name: 'Banco', archivedAt: null }, { id: SAVINGS, name: 'Reserva', archivedAt: null }] as ManualAccountRecord[];
const categories = [{ id: CATEGORY, name: 'Mercado', archivedAt: null }] as ManualCategoryRecord[];

describe('money input and display', () => {
  it.each([
    ['12,34', '12.34'], ['1.234,56', '1234.56'], ['R$ 0,10', '0.10'], ['12.5', '12.50'], ['1.234', '1234.00'], ['7', '7.00'],
    ['', null], ['abc', null], ['1,2,3', null], ['12,345', null],
  ])('parses %s', (text, expected) => expect(parseMoneyInput(text)).toBe(expected));

  it('formats API decimals without floating point and keeps missing values visible', () => {
    expect(money('0.30')).toBe(money('0.3'));
    expect(decimalToCents('0.10') + decimalToCents('0.20')).toBe(decimalToCents('0.30'));
    expect(decimalToCents('-12345678901234.56')).toBe(-1234567890123456n);
    expect(money(null)).toBe('indisponível');
    expect(money(undefined, 'sem saldo inicial')).toBe('sem saldo inicial');
    expect(() => decimalToCents('1e3')).toThrow();
  });
});

describe('quick entry form', () => {
  const form = { ...newEntryForm('2026-10-07', '2026-10', accounts, categories), description: 'Feira', amount: '45,90' };

  it('builds the payload accepted by the shared schema', () => {
    const result = validateEntry(form);
    expect(result).toEqual({ ok: true, data: expect.objectContaining({ accountId: ACCOUNT, categoryId: CATEGORY, amount: '45.90', kind: 'expense', status: 'settled', purchaseDate: '2026-10-07', competenceMonth: '2026-10-01', paidDate: '2026-10-07', toAccountId: null, notes: null }) });
    expect(newEntryForm('2026-10-07', '2026-09', accounts, categories).purchaseDate).toBe('2026-09-01');
  });

  it('reports field errors from the shared rules', () => {
    expect(validateEntry({ ...form, amount: 'x' })).toEqual({ ok: false, errors: { amount: 'Informe um valor como 12,34.' } });
    const transfer = validateEntry({ ...form, kind: 'transfer', toAccountId: ACCOUNT });
    expect(transfer.ok).toBe(false);
    if (!transfer.ok) expect(transfer.errors.toAccountId).toContain('outra conta');
    const zero = validateEntry({ ...form, amount: '0,00' });
    if (!zero.ok) expect(zero.errors.amount).toBe('Informe um valor maior que zero.');
    const empty = validateEntry({ ...form, description: ' ' });
    if (!empty.ok) expect(empty.errors.description).toBe('Preencha este campo.');
    expect(validateEntry({ ...form, kind: 'transfer', toAccountId: SAVINGS }).ok).toBe(true);
  });

  it('round-trips a server transfer and creates conditional mutations', () => {
    const row = { id: '50000000-0000-4000-8000-000000000001', kind: 'transfer', amount: '-100.00', accountId: SAVINGS, transferFromAccountId: ACCOUNT, toAccountId: SAVINGS, categoryId: CATEGORY, description: 'Reserva', status: 'settled', purchaseDate: '2026-10-02', competenceMonth: '2026-10-01', paidDate: '2026-10-02', notes: null, revision: 'r1' } as unknown as ManualEntryRecord;
    expect(entryFormFrom(row)).toMatchObject({ kind: 'transfer', amount: '100,00', accountId: ACCOUNT, toAccountId: SAVINGS, month: '2026-10' });
    const parsed = validateEntry(entryFormFrom(row));
    if (!parsed.ok) throw new Error('invalid');
    expect(saveEntryMutation(parsed.data, row)).toMatchObject({ method: 'PATCH', path: `/api/entries/${row.id}`, ifMatch: 'r1', resource: { type: 'entry', id: row.id } });
    expect(saveEntryMutation(parsed.data, null)).toMatchObject({ method: 'POST', path: '/api/entries', ifMatch: null, resource: null });
    expect(archiveEntryMutation(row)).toMatchObject({ method: 'DELETE', body: { action: 'archive' }, ifMatch: 'r1' });
    expect(archiveEntryMutation(row, true)).toMatchObject({ method: 'POST', body: { action: 'restore' } });
  });
});
