import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
const secure = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => secure.value, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));
import type { CardRecord, ImportRowView, InvoiceView, ManualAccountRecord, PlanningOccurrence } from '@ecofinance/shared';
import { archiveCardMutation, cardMutation, paymentMutation, purchasePreview } from './cards';
import { batchAction, checkPicked, intentKey, pendingReview, reviewBody, reviewForm, reviewFormBody, reviewItem, uploadImports, uploadSignature } from './imports';
import { budgetForm, budgetMutation, generateMutation, occurrenceMutation, ruleMutation } from './planning';
import { accountForm, accountMutation, archiveReferenceMutation, categoryMutation } from './references';

const ACCOUNT = '30000000-0000-4000-8000-000000000001', CATEGORY = '40000000-0000-4000-8000-000000000001';
const CARD: CardRecord = { id: '60000000-0000-4000-8000-000000000001', name: 'Visa', paymentAccountId: ACCOUNT, closingDay: 5, dueDay: 12, revision: 'c1', archived: false };
afterEach(() => { vi.unstubAllGlobals(); secure.value = null; });

describe('accounts and categories', () => {
  it('validates with the shared schema and sends revisions for edits', () => {
    const account = { id: ACCOUNT, name: 'Banco', type: 'banco', openingBalance: '-50.00', openingDate: '2026-01-01', color: '#10b981', sortOrder: 2, revision: 'a1', archivedAt: null } as ManualAccountRecord;
    const form = accountForm(account, '2026-10-07');
    expect(form.openingBalance).toBe('-50,00');
    expect(accountMutation(form, account)).toMatchObject({ ok: true, mutation: { method: 'PATCH', path: `/api/accounts/${ACCOUNT}`, ifMatch: 'a1', body: { openingBalance: '-50.00', sortOrder: 2 } } });
    expect(accountMutation({ ...form, openingBalance: 'x' }, undefined)).toEqual({ ok: false, errors: { openingBalance: 'Informe um valor como 1.234,56.' } });
    expect(accountMutation({ ...form, name: '' }, undefined)).toMatchObject({ ok: false, errors: { name: 'Preencha este campo.' } });
    expect(categoryMutation({ name: 'Mercado', color: '#10b981', icon: 'tag' }, undefined)).toMatchObject({ ok: true, mutation: { method: 'POST', path: '/api/categories', ifMatch: null } });
    expect(archiveReferenceMutation('account', account)).toMatchObject({ body: { action: 'archive' }, ifMatch: 'a1', resource: { type: 'account', id: ACCOUNT } });
    expect(archiveReferenceMutation('category', { ...account, archivedAt: '2026-10-01' })).toMatchObject({ path: `/api/categories/${ACCOUNT}`, body: { action: 'restore' } });
  });
});

describe('planning', () => {
  const occurrence = { id: '70000000-0000-4000-8000-000000000001', description: 'Aluguel', amount: '1500.00', revision: 'o1' } as PlanningOccurrence;
  it('creates a budget with If-Match "new" and keeps web category limits on edit', () => {
    expect(budgetForm(null)).toEqual({ limit: '', expectedIncome: '', reserve: '0,00' });
    expect(budgetMutation('2026-10', null, { limit: '3.000,00', expectedIncome: '5000', reserve: '0' })).toMatchObject({ ok: true, mutation: { method: 'PUT', path: '/api/planning/2026-10', ifMatch: 'new', body: { limit: '3000.00', expectedIncome: '5000.00', reserve: '0.00', categories: [] } } });
    const plan = { id: 'b', revision: 'b1', limit: '1.00', expectedIncome: '1.00', reserve: '0.00', categories: [{ categoryId: CATEGORY, limit: '10.00' }] };
    expect(budgetMutation('2026-10', plan, budgetForm(plan))).toMatchObject({ ok: true, mutation: { ifMatch: 'b1', body: { categories: plan.categories } } });
    expect(budgetMutation('2026-10', null, { limit: '-1', expectedIncome: '1', reserve: '0' })).toMatchObject({ ok: false });
  });
  it('pays, postpones and cancels occurrences under their revision', () => {
    expect(occurrenceMutation(occurrence, '2026-10', 'pay', { amount: '1.500,00', date: '2026-10-10' })).toMatchObject({ ok: true, mutation: { path: `/api/occurrences/${occurrence.id}/pay`, body: { amount: '1500.00', paidDate: '2026-10-10' }, ifMatch: 'o1', resource: { type: 'occurrence', id: occurrence.id, month: '2026-10' } } });
    expect(occurrenceMutation(occurrence, '2026-10', 'pay', { amount: '0', date: '2026-10-10' })).toMatchObject({ ok: false, errors: { amount: 'Informe um valor maior que zero.' } });
    expect(occurrenceMutation(occurrence, '2026-10', 'postpone', { date: '2026-02-30' })).toMatchObject({ ok: false, errors: { dueDate: expect.stringContaining('Data civil') } });
    expect(occurrenceMutation(occurrence, '2026-10', 'cancel')).toMatchObject({ ok: true, mutation: { body: {} } });
    expect(generateMutation('2026-10')).toMatchObject({ path: '/api/planning/2026-10/generate', body: {}, ifMatch: null });
  });
  it('builds a recurrence version starting in the viewed month', () => {
    const form = { description: 'Internet', amount: '99,90', accountId: ACCOUNT, categoryId: CATEGORY, dueDay: '31', startDate: '2026-10-01', estimated: false };
    expect(ruleMutation('2026-10', form)).toMatchObject({ ok: true, mutation: { path: '/api/recurrences', body: { fromMonth: '2026-10', schedule: { amount: '99.90', dueDay: 31, endDate: null, paused: false } } } });
    expect(ruleMutation('2026-10', { ...form, dueDay: '32' })).toMatchObject({ ok: false, errors: { dueDay: 'Revise este campo.' } });
  });
});

describe('cards and invoices', () => {
  it('previews installments with the shared split before confirming (300 in 3x100)', () => {
    const preview = purchasePreview(CARD, { description: 'Geladeira', categoryId: CATEGORY, totalAmount: '300,00', count: '3', purchaseDate: '2026-10-02', firstMonth: '2026-10' });
    if (!preview.ok) throw new Error('invalid');
    expect(preview.parts.map(part => [part.month, part.amount])).toEqual([['2026-10', '100.00'], ['2026-11', '100.00'], ['2026-12', '100.00']]);
    expect(preview.mutation).toMatchObject({ path: `/api/cards/${CARD.id}/purchases`, body: { confirmed: true, count: 3 }, label: expect.stringContaining('(3x)') });
    const uneven = purchasePreview(CARD, { description: 'X', categoryId: CATEGORY, totalAmount: '100,00', count: '3', purchaseDate: '2026-10-02', firstMonth: '2026-10' });
    if (uneven.ok) expect(uneven.parts.map(part => part.amount)).toEqual(['33.34', '33.33', '33.33']);
  });
  it('pays an invoice once under its revision and validates cards', () => {
    const invoice = { id: '80000000-0000-4000-8000-000000000001', revision: 'i1', month: '2026-10' } as InvoiceView;
    expect(paymentMutation(CARD, invoice, { amount: '250,00', paidDate: '2026-10-12', categoryId: CATEGORY })).toMatchObject({ ok: true, mutation: { path: `/api/invoices/${invoice.id}/pay`, ifMatch: 'i1', body: { amount: '250.00', transactionId: null, confirmed: true }, resource: { type: 'invoice', cardId: CARD.id, month: '2026-10' } } });
    expect(cardMutation({ name: 'Visa', paymentAccountId: ACCOUNT, closingDay: '40', dueDay: '10' })).toMatchObject({ ok: false, errors: { closingDay: expect.any(String) } });
    expect(cardMutation({ name: 'Visa', paymentAccountId: ACCOUNT, closingDay: '5', dueDay: '12' }, CARD)).toMatchObject({ ok: true, mutation: { method: 'PUT', ifMatch: 'c1' } });
    expect(archiveCardMutation(CARD)).toMatchObject({ method: 'PATCH', body: { action: 'archive' } });
  });
});

describe('import from the file picker', () => {
  const row = { id: '90000000-0000-4000-8000-000000000001', description: 'Padaria', amount: '-12.00', purchaseDate: '2026-10-03', competenceMonth: '2026-10-01', categoryId: null, selected: false, resolution: 'new', duplicateId: null, revision: 'r1' } as ImportRowView;
  it('checks file limits before uploading', () => {
    expect(checkPicked([])).toBe('Selecione ao menos um arquivo.');
    expect(checkPicked([{ uri: 'file:///a.ofx', name: 'a.ofx', mimeType: null, size: 300 * 1024 }])).toContain('256 KiB');
    expect(checkPicked(Array.from({ length: 11 }, (_, i) => ({ uri: `file:///${i}`, name: `${i}.csv`, mimeType: 'text/csv', size: 10 })))).toContain('até 10');
    expect(checkPicked([{ uri: 'file:///a.ofx', name: 'a.ofx', mimeType: null, size: null }])).toBeNull();
  });
  it('reuses one Idempotency-Key per intent so a retried upload or commit is not duplicated', () => {
    const keys = new Map<string, string>();
    const files = [{ uri: 'file:///a.ofx', name: 'a.ofx', mimeType: null, size: 10 }];
    const target = { accountId: ACCOUNT, cardId: null } as const;
    const first = intentKey(keys, uploadSignature(files, target));
    expect(intentKey(keys, uploadSignature(files, target))).toBe(first);
    expect(intentKey(keys, uploadSignature([{ ...files[0]!, name: 'b.ofx' }], target))).not.toBe(first);
  });
  it('requires a category and a chosen duplicate before a reviewed row is sent', () => {
    expect(reviewBody(row, { resolution: 'link' })).toMatchObject({ ok: false });
    expect(reviewBody(row, { categoryId: CATEGORY, selected: true })).toEqual({ ok: true, body: { description: 'Padaria', amount: '-12.00', purchaseDate: '2026-10-03', competenceMonth: '2026-10-01', categoryId: CATEGORY, selected: true, resolution: 'new', duplicateId: null } });
  });
  it('repairs missing imported fields with signed cents and an explicit competence month', () => {
    const invalid = { ...row, state: 'invalid', description: null, amount: null, purchaseDate: null, competenceMonth: null };
    expect(reviewForm(invalid)).toMatchObject({ description: '', amount: '', purchaseDate: '', competenceMonth: '', selected: false });
    const form = { ...reviewForm(invalid), description: '  Mercado  ', amount: '-1.234,56', purchaseDate: '2026-09-30', competenceMonth: '2026-10', categoryId: CATEGORY, selected: true };
    expect(reviewFormBody(invalid, form)).toEqual({ ok: true, body: { description: 'Mercado', amount: '-1234.56', purchaseDate: '2026-09-30', competenceMonth: '2026-10-01', categoryId: CATEGORY, selected: true, resolution: 'new', duplicateId: null } });
    expect(reviewForm(row).amount).toBe('-12,00');
    expect(reviewFormBody(row, { ...form, amount: '0,01', selected: false })).toMatchObject({ ok: true, body: { amount: '0.01', selected: false } });
    expect(reviewFormBody(row, { ...form, resolution: 'exclude', selected: true, duplicateId: row.id })).toMatchObject({ ok: true, body: { selected: false, resolution: 'exclude', duplicateId: null } });
  });
  it('reports all invalid fields without silently rounding money or changing the purchase month', () => {
    const form = { ...reviewForm(row), categoryId: CATEGORY };
    expect(reviewFormBody(row, { ...form, amount: '1,999', purchaseDate: '2026-02-30', competenceMonth: '2026-13' })).toMatchObject({ ok: false, errors: { amount: expect.any(String), purchaseDate: expect.any(String), competenceMonth: expect.any(String) } });
    expect(reviewFormBody(row, { ...form, amount: '0' })).toMatchObject({ ok: false, errors: { amount: 'Informe valor diferente de zero.' } });
    expect(reviewFormBody(row, { ...form, competenceMonth: '2026-10-01' })).toMatchObject({ ok: false });
    expect(reviewFormBody(row, { ...form, resolution: 'link', duplicateId: null })).toMatchObject({ ok: false, errors: { form: 'Escolha o lançamento existente.' } });
  });
  it('keeps unsaved drafts across server changes and blocks confirmation until a saved version is refreshed', () => {
    const draft = { base: row, form: { ...reviewForm(row), amount: '-99,90' }, saved: false, errors: {} };
    const refreshed = { ...row, amount: '-88.00', revision: 'r2' };
    expect(pendingReview(draft, refreshed)).toBe(draft);
    expect(draft.base.revision).toBe('r1');
    expect(draft.form.amount).toBe('-99,90');
    const saved = { ...draft, saved: true };
    expect(pendingReview(saved, row)).toBe(saved);
    expect(pendingReview(saved, refreshed)).toBeUndefined();
    expect(pendingReview(undefined, row)).toBeUndefined();
  });
  it('retries a lost review response with the same intent and original row revision', async () => {
    secure.value = JSON.stringify({ url: 'https://api.example.test', credential: 'synthetic.signed', userId: '10000000-0000-4000-8000-000000000001' });
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValueOnce(new Response(JSON.stringify({ revision: 'r2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const built = reviewFormBody(row, { ...reviewForm(row), amount: '-123,45', categoryId: CATEGORY, selected: true });
    if (!built.ok) throw new Error('invalid');
    const keys = new Map<string, string>();
    const signature = JSON.stringify(['review', row.id, row.revision, built.body]);
    await expect(reviewItem('b1', row, built.body, intentKey(keys, signature))).rejects.toMatchObject({ kind: 'offline' });
    await reviewItem('b1', row, built.body, intentKey(keys, signature));
    const requests = fetch.mock.calls.map(([url, init]) => [url, init.headers.get('If-Match'), init.headers.get('Idempotency-Key'), init.body]);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toEqual(['https://api.example.test/api/imports/b1/items/' + row.id, '"r1"', expect.any(String), JSON.stringify(built.body)]);
    expect(intentKey(keys, JSON.stringify(['review', row.id, 'r2', built.body]))).not.toBe(requests[0]![2]);
  });
  it('uploads multipart with the key and confirms under the batch revision', async () => {
    secure.value = JSON.stringify({ url: 'https://api.example.test', credential: 'synthetic.signed', userId: '10000000-0000-4000-8000-000000000001' });
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ batches: [] }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await uploadImports([{ uri: 'file:///a.csv', name: 'a.csv', mimeType: 'text/csv', size: 10 }], { accountId: ACCOUNT, cardId: null }, 'k-upload');
    const [, init] = fetch.mock.calls[0]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('accountId')).toBe(ACCOUNT);
    expect(init.headers.get('Idempotency-Key')).toBe('k-upload');
    expect(init.headers.has('Content-Type')).toBe(false);
    await batchAction({ id: 'b1', revision: 'rev' } as never, 'confirm', 'k-confirm');
    const [url, confirm] = fetch.mock.calls[1]!;
    expect(url).toBe('https://api.example.test/api/imports/b1/confirm');
    expect(confirm.body).toBe('{"confirmed":true}');
    expect(confirm.headers.get('If-Match')).toBe('"rev"');
  });
});
