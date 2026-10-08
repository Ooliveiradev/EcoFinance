import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testStore, clearTestCollections } from './firestore-fixture';
import { DocumentStore, expireImportOriginals, type Database, type Models } from '../src';
import { migrateToFirebase } from '../src/firebase-migration';
import { saveAccount, saveCategory, saveEntry, archiveEntry } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard } from '../../../apps/next/src/lib/card-store';
import { addCardPurchase, addInvoiceItem } from '../../../apps/next/src/lib/card-purchases';
import { loadInvoice } from '../../../apps/next/src/lib/card-read';
import { saveRule, generateMonth } from '../../../apps/next/src/lib/planning-rules';
import { payOccurrence } from '../../../apps/next/src/lib/planning-occurrences';
import { loadPlanning } from '../../../apps/next/src/lib/planning-read';
import { saveBudget, closeMonth } from '../../../apps/next/src/lib/planning-budget';
import { receiveImports, processImport, loadImport, reviewImportItem, importIdentity } from '../../../apps/next/src/lib/import-store';
import { confirmImport } from '../../../apps/next/src/lib/import-commit';
import { exportBackup, previewRestore, restoreBackup, ownedData, dataRevision, sealBackup, type UserBackup } from '../../../apps/next/src/lib/data-backup';
import { dataSummary, deleteUserData, discardOriginal, exportEntries } from '../../../apps/next/src/lib/data-control';
import { provisionUser } from '../../../apps/next/src/lib/provision-user';
import { accountBalances, monthTotals, monthlyDueDate, BACKUP_COLLECTIONS, DELETE_DATA_CONFIRMATION, DELETE_ACCOUNT_CONFIRMATION, type BackupCollection } from '../../shared/src';

const db = testStore('data-' + randomBytes(6).toString('hex')), fresh = testStore('data-empty-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000001', adopter = randomUUID();
let account: string, wallet: string, category: string, foreign: string, card: string;
const confirm = { confirm: 'RESTAURAR' };
const csvRow = (rows: string) => ({ name: 'extrato.csv', mime: 'text/csv', bytes: new TextEncoder().encode('data;descricao;valor\n' + rows) });
const entry = (patch: Record<string, unknown> = {}) => ({ accountId: account, categoryId: category, description: 'Mercado', amount: '12.34', kind: 'expense', status: 'settled', purchaseDate: '2028-03-02', competenceMonth: '2028-03-01', dueDate: null, paidDate: '2028-03-02', notes: null, ...patch });
const json = (backup: UserBackup) => JSON.parse(JSON.stringify(backup)) as UserBackup;
/** Re-seals an edited backup, as a hostile client could. */
function forge(backup: UserBackup, edit: (collections: Record<BackupCollection, Record<string, unknown>[]>) => void) {
  const copy = json(backup); edit(copy.collections as never);
  return sealBackup({ format: copy.format, version: copy.version, ownerId: copy.ownerId, createdAt: copy.createdAt, collections: copy.collections });
}
async function state(store: Database, id: string) { return store.transaction(tx => ownedData(tx, id)); }
async function revisionOf(store: Database, id: string) { return dataRevision(await state(store, id)); }
async function stage(store: Database, id: string, accountId: string, rows: string) {
  const received = await receiveImports(store, id, randomUUID(), [csvRow(rows)], { accountId, cardId: null });
  const first = (received.batches as { id: string; revision: string }[])[0]!;
  return processImport(store, id, first.id, first.revision);
}
/** Exact cash/competence totals and every financial link of an owner, independent of identities. */
async function fingerprint(store: Database, id: string) {
  const rows = await state(store, id);
  const name = new Map([...rows.accounts, ...rows.categories, ...rows.cards].map(r => [r.id, String(r.name)]));
  const tx = rows.transactions as unknown as Models['transactions'][];
  const byId = new Map(tx.map(r => [r.id, r]));
  const balances = accountBalances(rows.accounts as unknown as Models['accounts'][], tx, '2028-12-31');
  return {
    counts: Object.fromEntries(BACKUP_COLLECTIONS.map(c => [c, rows[c].length])),
    balances: Object.fromEntries([...balances].map(([k, v]) => [name.get(k), String(v)])),
    months: ['2028-02', '2028-03', '2028-04', '2028-05'].map(m => monthTotals(tx, m)).map(t => [String(t.income), String(t.expenses)]),
    transfers: tx.filter(r => r.transferId).map(r => tx.filter(o => o.transferId === r.transferId).length),
    refunds: tx.filter(r => r.refundOfId).map(r => byId.get(r.refundOfId!)?.description),
    invoices: tx.filter(r => r.invoiceId).map(r => rows.invoices.some(i => i.id === r.invoiceId) && (!r.installmentId || rows.installments.some(i => i.id === r.installmentId))),
    occurrences: rows.recurrenceOccurrences.filter(o => o.transactionId).map(o => byId.get(String(o.transactionId))?.recurrenceOccurrenceId === o.id),
    importItems: rows.importItems.filter(i => i.transactionId).map(i => byId.has(String(i.transactionId))),
    closed: rows.planningMonths.filter(m => m.closedAt).map(m => m.competenceMonth),
  };
}
beforeAll(async () => {
  for (const store of [db, fresh]) await clearTestCollections(store);
  await migrateToFirebase(db, JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json', 'utf8')));
  const now = new Date();
  await fresh.put('users', { id: adopter, displayName: 'Nova instalação', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Banco backup', type: 'banco', openingBalance: '1000.00', openingDate: '2028-01-01' })).id);
  wallet = String((await saveAccount(db, owner, randomUUID(), { name: 'Carteira backup', type: 'carteira', openingBalance: '0.00', openingDate: '2028-01-01' })).id);
  foreign = String((await saveAccount(db, other, randomUUID(), { name: 'Conta de outra pessoa', type: 'banco', openingBalance: '5.00', openingDate: '2028-01-01' })).id);
  category = String((await saveCategory(db, owner, randomUUID(), { name: '=HYPERLINK("http://x")', color: '#112233' })).id);
  await saveEntry(db, owner, randomUUID(), entry({ description: '=HYPERLINK("https://evil.test","ok")' }));
  await saveEntry(db, owner, randomUUID(), entry({ description: '+SUM(1,2)', kind: 'income', amount: '2000.01' }));
  await saveEntry(db, owner, randomUUID(), entry({ description: '@cmd', notes: '-1+1' }));
  await saveEntry(db, owner, randomUUID(), entry({ description: 'Reserva', kind: 'transfer', toAccountId: wallet, amount: '300.00' }));
  const archived = await saveEntry(db, owner, randomUUID(), entry({ description: 'Arquivado', amount: '1.00' }));
  await archiveEntry(db, owner, randomUUID(), String(archived.id), String(archived.revision), true);
  card = String((await saveCard(db, owner, randomUUID(), { name: 'Cartão backup', paymentAccountId: account, closingDay: 25, dueDay: 5 })).id);
  await addCardPurchase(db, owner, randomUUID(), card, { description: 'Notebook', categoryId: category, totalAmount: '300.00', count: 3, purchaseDate: '2028-02-28', firstMonth: '2028-02', confirmed: true });
  const february = await loadInvoice(db, owner, card, '2028-02'), march = await loadInvoice(db, owner, card, '2028-03');
  await addInvoiceItem(db, owner, randomUUID(), march.id, march.revision, { type: 'refund', description: 'Estorno parcial', amount: '25.00', categoryId: category, purchaseDate: '2028-03-28', competenceMonth: '2028-02', refundOfId: february.entries[0]!.id });
  const rule = await saveRule(db, owner, randomUUID(), { fromMonth: '2028-03', schedule: { accountId: account, categoryId: category, description: 'Aluguel', amount: '800.00', startDate: '2028-03-01', endDate: monthlyDueDate('2028-04', 10), dueDay: 10, estimated: false, reminderDays: 3, paused: false } });
  await generateMonth(db, owner, randomUUID(), '2028-03');
  const due = (await loadPlanning(db, owner, '2028-03')).occurrences.find(o => o.ruleId === rule.id)!;
  await payOccurrence(db, owner, randomUUID(), due.id, due.revision, { amount: '800.00', paidDate: '2028-03-10' });
  await saveBudget(db, owner, randomUUID(), '2028-03', { limit: '2000.00', expectedIncome: '2000.00', reserve: '100.00', categories: [{ categoryId: category, limit: '1500.00' }] }, '');
  const batch = await stage(db, owner, account, '2028-03-15;Farmácia;-45.60');
  const row = batch.rows[0]!;
  await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: row.description, amount: row.amount, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, categoryId: category, selected: true, resolution: 'new', duplicateId: null });
  const reviewed = await loadImport(db, owner, batch.id);
  await confirmImport(db, owner, randomUUID(), batch.id, reviewed.revision, { confirmed: true });
  await receiveImports(db, owner, randomUUID(), [csvRow('2028-03-20;Ainda não analisado;-1.00')], { accountId: account, cardId: null });
  const april = await loadPlanning(db, owner, '2028-04');
  await closeMonth(db, owner, randomUUID(), '2028-04', april.monthRevision, { action: 'close' });
});
afterAll(async () => { for (const store of [db, fresh]) { await clearTestCollections(store); await store.firestore.terminate(); } });

it('exports a versioned owner-only backup without originals, and an entry CSV that neutralizes formulas', async () => {
  const backup = await exportBackup(db, owner), text = JSON.stringify(backup);
  expect(backup).toMatchObject({ format: 'ecofinance-user-backup', version: 1, ownerId: owner, summary: { entries: { archived: 1 } } });
  const rows = await state(db, owner);
  expect(backup.summary.counts).toEqual(Object.fromEntries(BACKUP_COLLECTIONS.map(c => [c, rows[c].length])));
  expect(BACKUP_COLLECTIONS.filter(c => !['uberTripsMetadata', 'preferences'].includes(c) && !rows[c].length)).toEqual([]);
  expect(text).not.toContain(foreign); expect(text).not.toContain(other); expect(text).not.toContain('"payload":"');
  const csv = await exportEntries(db, owner, {});
  expect(csv).toContain(`'=HYPERLINK(""https://evil.test"",""ok"")`); expect(csv).toContain(`'+SUM(1,2)`); expect(csv).toContain(`'@cmd`); expect(csv).toContain(`'-1+1`);
  expect(csv).toContain('-12.34'); expect(csv).not.toContain('Conta de outra pessoa');
  const cells = csv.replace(/^\uFEFF/, '').split('\r\n').flatMap(line => line.split(';')).map(cell => cell.replace(/^"|"$/g, ''));
  expect(cells.filter(cell => /^(?:[\t\r]|\s*[=+\-@])/.test(cell) && !/^-?\d+(?:\.\d+)?$/.test(cell))).toEqual([]);
  expect(await exportEntries(db, owner, { from: '2028-03-15', to: '2028-03-15' })).toContain('Farmácia');
});

it('restores into an empty installation under another owner only through adoption, preserving totals and links', async () => {
  const backup = json(await exportBackup(db, owner)), expected = await fingerprint(db, owner);
  const preview = await previewRestore(fresh, adopter, { backup });
  expect(preview).toMatchObject({ foreignOwner: true, backup: expected.counts, totals: backup.summary.entries });
  expect(Object.values(preview.current).every(n => n === 0)).toBe(true);
  expect(await revisionOf(fresh, adopter)).toBe(preview.currentRevision);
  await expect(restoreBackup(fresh, adopter, randomUUID(), { backup, ...confirm }, preview.currentRevision)).rejects.toMatchObject({ code: 'FOREIGN_BACKUP' });
  await expect(restoreBackup(fresh, adopter, randomUUID(), { backup, ownerMode: 'adopt' }, preview.currentRevision)).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  const key = randomUUID(), restored = await restoreBackup(fresh, adopter, key, { backup, ownerMode: 'adopt', ...confirm }, preview.currentRevision);
  expect(await restoreBackup(fresh, adopter, key, { backup, ownerMode: 'adopt', ...confirm }, preview.currentRevision)).toEqual(restored);
  expect(await fingerprint(fresh, adopter)).toEqual(expected);
  expect(restored.revision).toBe(await revisionOf(fresh, adopter));
  // New identities: nothing collides with the source owner, owner-derived lookups still work.
  const rows = await state(fresh, adopter), source = await state(db, owner);
  const sourceIds = new Set(BACKUP_COLLECTIONS.flatMap(c => source[c].map(r => r.id)));
  expect(BACKUP_COLLECTIONS.flatMap(c => rows[c]).some(r => sourceIds.has(r.id) || r.ownerId !== adopter)).toBe(false);
  expect((await loadPlanning(fresh, adopter, '2028-04')).closed).toBe(true);
  const planned = await loadPlanning(fresh, adopter, '2028-03');
  expect(planned.plan).toMatchObject({ limit: '2000.00' }); expect(planned.occurrences[0]).toMatchObject({ status: 'paid' });
  const restoredCard = rows.cards.find(c => c.name === 'Cartão backup')!.id, invoice = await loadInvoice(fresh, adopter, restoredCard, '2028-03'), sourceInvoice = await loadInvoice(db, owner, card, '2028-03');
  expect(invoice.totals).toEqual(sourceInvoice.totals); expect(invoice.entries.map(e => [e.description, e.amount])).toEqual(sourceInvoice.entries.map(e => [e.description, e.amount]));
  const batch = rows.importBatches.find(b => b.state === 'confirmed' && b.filename === 'extrato.csv')!, item = rows.importItems.find(i => i.batchId === batch.id)!;
  expect(item.transactionId).toBe(importIdentity(batch as never, item as never));
  expect((await loadImport(fresh, adopter, batch.id)).rows[0]).toMatchObject({ state: 'committed' });
  expect(rows.importBatches.find(b => b.state !== 'confirmed' && b.filename === 'extrato.csv')).toMatchObject({ state: 'failed', payload: null });
  expect(await generateMonth(fresh, adopter, randomUUID(), '2028-03')).toMatchObject({ created: 0 });
});

it('replaces the same owner\'s changed data atomically after preview, with If-Match and idempotent replay', async () => {
  const backup = json(await exportBackup(db, owner)), before = await fingerprint(db, owner);
  const added = await saveEntry(db, owner, randomUUID(), entry({ description: 'Depois do backup', amount: '99.99' }));
  const preview = await previewRestore(db, owner, { backup });
  expect(preview.foreignOwner).toBe(false); expect(preview.current.transactions).toBe(preview.backup.transactions + 1);
  await saveEntry(db, owner, randomUUID(), entry({ description: 'Concorrente', amount: '0.01' }));
  await expect(restoreBackup(db, owner, randomUUID(), { backup, ...confirm }, preview.currentRevision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const fresher = await previewRestore(db, owner, { backup }), key = randomUUID();
  const result = await restoreBackup(db, owner, key, { backup, ...confirm }, fresher.currentRevision);
  expect(await restoreBackup(db, owner, key, { backup, ...confirm }, fresher.currentRevision)).toEqual(result);
  expect(await fingerprint(db, owner)).toEqual(before);
  expect(await db.get('transactions', String(added.id))).toBeNull();
  const sameIds = (await state(db, owner)).transactions.map(r => r.id).sort();
  expect(sameIds).toEqual((backup.collections.transactions as { id: string }[]).map(r => r.id).sort());
  // Unique claims were released and re-acquired coherently: normal writes keep working.
  expect((await saveEntry(db, owner, randomUUID(), entry({ description: 'Após restauração' }))).id).toBeTypeOf('string');
});

it('rejects tampered, mixed-owner, cross-owner and incompatible backups without touching any data', async () => {
  const backup = json(await exportBackup(db, owner)), mine = await revisionOf(db, owner), theirs = await revisionOf(db, other), current = { ...confirm };
  const attempts: [unknown, string][] = [
    [{ ...backup, summary: { ...backup.summary, entries: { ...backup.summary.entries, amount: '0.00' } } }, 'INVALID_BACKUP'],
    [{ ...backup, version: 2 }, 'UNSUPPORTED_BACKUP_VERSION'],
    [{ ...backup, format: 'other' }, 'INVALID_BACKUP'],
    [forge(backup, c => { c.transactions[0]!.ownerId = other; }), 'INVALID_BACKUP'],
    [forge(backup, c => { c.accounts[0]!.id = foreign; }), 'INVALID_BACKUP'],
    [forge(backup, c => { c.accounts[0]!['nested.path'] = 1; }), 'INVALID_BACKUP'],
    [forge(backup, c => { (c.transactions.find(r => r.accountId === account) as Record<string, unknown>).accountId = foreign; }), 'INVALID_BACKUP'],
    [forge(backup, c => { (c.transactions.find(r => r.description === '@cmd') as Record<string, unknown>).amount = '5.00'; }), 'INVALID_BACKUP'],
    [forge(backup, c => { c.transactions.push({ ...c.transactions.find(r => r.description === '@cmd')!, id: randomUUID(), externalId: 'x', kind: 'income', amount: '-1.00' }); }), 'INVALID_BACKUP'],
  ];
  for (const [input, code] of attempts) {
    await expect(previewRestore(db, owner, { backup: input })).rejects.toMatchObject({ code });
    await expect(restoreBackup(db, owner, randomUUID(), { backup: input, ...current }, mine)).rejects.toMatchObject({ code });
  }
  const big = forge(backup, c => { for (let i = 0; i < 3001; i++) c.uberTripsMetadata.push({ id: randomUUID(), ownerId: owner }); });
  await expect(previewRestore(db, owner, { backup: big })).rejects.toMatchObject({ code: 'BACKUP_TOO_LARGE' });
  await expect(previewRestore(db, owner, { backup: [] })).rejects.toThrow();
  expect(await revisionOf(db, owner)).toBe(mine); expect(await revisionOf(db, other)).toBe(theirs);
  expect((await db.get('accounts', foreign))!.ownerId).toBe(other);
});

it('leaves no partial state when the restore transaction is interrupted at any point', async () => {
  const backup = json(await exportBackup(db, owner));
  await saveEntry(db, owner, randomUUID(), entry({ description: 'Estado anterior à falha' }));
  const before = await state(db, owner), revision = dataRevision(before), original = DocumentStore.prototype.put;
  const total = BACKUP_COLLECTIONS.reduce((sum, c) => sum + backup.collections[c].length, 0);
  for (const failAt of [1, Math.floor(total / 2), total + 1]) {
    let calls = 0;
    DocumentStore.prototype.put = async function (this: DocumentStore, ...args: Parameters<DocumentStore['put']>) {
      if (args[0] !== 'operations' && ++calls === failAt) throw new Error('simulated crash');
      return original.apply(this, args);
    };
    try { await expect(restoreBackup(db, owner, randomUUID(), { backup, ...confirm }, revision)).rejects.toBeDefined(); }
    finally { DocumentStore.prototype.put = original; }
    expect(await state(db, owner)).toEqual(before);
  }
  const ok = await restoreBackup(db, owner, randomUUID(), { backup, ...confirm }, revision);
  expect(ok.restored.transactions).toBe(backup.collections.transactions.length);
});

it('restores a large backup atomically within the documented limits', async () => {
  const backup = json(await exportBackup(db, owner)), template = backup.collections.transactions.find(r => (r as Record<string, unknown>).description === '@cmd') as Record<string, unknown>;
  const large = forge(backup, c => { for (let i = 0; i < 1500; i++) c.transactions.push({ ...template, id: randomUUID(), externalId: 'volume:' + i, revision: randomUUID() }); });
  const started = Date.now(), preview = await previewRestore(db, owner, { backup: large });
  expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(6 * 1024 * 1024);
  await restoreBackup(db, owner, randomUUID(), { backup: large, ...confirm }, preview.currentRevision);
  expect((await state(db, owner)).transactions).toHaveLength(preview.backup.transactions);
  expect(Date.now() - started).toBeLessThan(120000);
  const back = await previewRestore(db, owner, { backup });
  await restoreBackup(db, owner, randomUUID(), { backup, ...confirm }, back.currentRevision);
}, 180000);

it('expires temporary originals, shows the policy and lets the owner discard one without invalidating entries', async () => {
  const pending = await stage(db, owner, account, '2028-05-01;Revisar;-3.00');
  const summary = await dataSummary(db, owner);
  expect(summary).toMatchObject({ retentionDays: 7, limits: { restoreDocuments: 3000 } });
  const original = summary.originals.find(o => o.id === pending.id)!;
  expect(Date.parse(original.expiresAt) - Date.parse(original.createdAt)).toBe(7 * 86400000);
  await discardOriginal(db, owner, randomUUID(), original.id, original.revision);
  const kept = await loadImport(db, owner, pending.id); expect(kept).toMatchObject({ state: 'review' }); expect(kept.rows).toHaveLength(1);
  await expect(discardOriginal(db, owner, randomUUID(), pending.id, kept.revision)).rejects.toMatchObject({ code: 'NO_ORIGINAL' });
  const stuck = (await receiveImports(db, owner, randomUUID(), [csvRow('2028-05-02;Falha;-1.00')], { accountId: account, cardId: null })).batches as { id: string }[];
  const later = new Date(Date.now() + 8 * 86400000);
  expect(await expireImportOriginals(db, later, other)).toBe(0);
  expect((await db.get('importBatches', stuck[0]!.id))!.payload).not.toBeNull();
  expect(await expireImportOriginals(db, later, owner)).toBeGreaterThan(0);
  expect(await db.get('importBatches', stuck[0]!.id)).toMatchObject({ state: 'failed', payload: null, error: expect.stringContaining('7 dias') });
  expect(await expireImportOriginals(db, later)).toBe(0);
  expect((await db.owned('importBatches', owner)).filter(b => b.payload != null)).toEqual([]);
  expect((await db.owned('transactions', owner)).some(r => r.description === 'Farmácia' && r.archivedAt === null)).toBe(true);
});

it('deletes only with typed confirmation and current revision, isolated by owner, then removes the whole account', async () => {
  const theirs = await revisionOf(db, other), summary = await dataSummary(db, owner);
  await expect(deleteUserData(db, owner, { scope: 'data', confirm: 'sim' }, summary.revision)).rejects.toThrow();
  await expect(deleteUserData(db, owner, { scope: 'account', confirm: DELETE_DATA_CONFIRMATION }, summary.revision)).rejects.toThrow();
  await expect(deleteUserData(db, owner, { scope: 'data', confirm: DELETE_DATA_CONFIRMATION }, 'stale')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const result = await deleteUserData(db, owner, { scope: 'data', confirm: DELETE_DATA_CONFIRMATION }, summary.revision);
  expect(result.deleted.transactions).toBeGreaterThan(0);
  expect(Object.values((await dataSummary(db, owner)).counts).every(n => n === 0)).toBe(true);
  expect(await db.owned('operations', owner)).toEqual([]);
  expect(await db.get('users', owner)).not.toBeNull();
  expect(await revisionOf(db, other)).toBe(theirs); expect(await db.get('accounts', foreign)).not.toBeNull();
  expect(await deleteUserData(db, owner, { scope: 'data', confirm: DELETE_DATA_CONFIRMATION }, summary.revision)).toMatchObject({ scope: 'data' });
  // A new account in the restored installation is removed with login, sessions and email claim.
  const email = 'adopter-' + randomBytes(4).toString('hex') + '@example.test';
  await fresh.put('users', { ...(await fresh.get('users', adopter))!, email, updatedAt: new Date() });
  await provisionUser(fresh, { email: 'second-' + email, password: 'synthetic-password-1', name: 'Outro usuário' });
  const now = new Date();
  await fresh.put('authAccounts', { id: randomUUID(), userId: adopter, accountId: adopter, providerId: 'credential', password: 'x', accessToken: null, refreshToken: null, idToken: null, scope: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, createdAt: now, updatedAt: now });
  await fresh.put('authSessions', { id: randomUUID(), userId: adopter, token: randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 3600000), ipAddress: null, userAgent: null, createdAt: now, updatedAt: now });
  const account = await dataSummary(fresh, adopter);
  await deleteUserData(fresh, adopter, { scope: 'account', confirm: DELETE_ACCOUNT_CONFIRMATION }, account.revision);
  expect(await fresh.get('users', adopter)).toBeNull();
  expect(await fresh.query('authAccounts', { where: [{ field: 'userId', value: adopter }] })).toEqual([]);
  expect(await fresh.query('authSessions', { where: [{ field: 'userId', value: adopter }] })).toEqual([]);
  expect(await fresh.query('users', { where: [{ field: 'email', value: 'second-' + email }] })).toHaveLength(1);
  expect(await provisionUser(fresh, { email, password: 'synthetic-password-2', name: 'Reaproveita email' })).toBeTypeOf('string');
});
