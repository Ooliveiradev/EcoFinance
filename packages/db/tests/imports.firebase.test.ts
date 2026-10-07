import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { DocumentStore, type Database, type Collection, type Models } from '../src';
import { backupFirebase, restoreFirebase } from '../src/firebase-migration';
import { saveAccount, saveCategory, saveEntry, archiveEntry,revision } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard } from '../../../apps/next/src/lib/card-store';
import { loadInvoice } from '../../../apps/next/src/lib/card-read';
import { receiveImports, processImport, loadImport, reviewImportItem, cancelImport,repeatImport } from '../../../apps/next/src/lib/import-store';
import { confirmImport, undoImport } from '../../../apps/next/src/lib/import-commit';
import { accountBalances, monthTotals, type ImportBatchView } from '../../shared/src';
const db = testStore('imports-' + randomBytes(6).toString('hex')), copy = testStore('imports-copy-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001', other = '20000000-0000-4000-8000-000000000001';
let account: string, category: string, foreign: string, card: string;
beforeAll(async () => { await clearTestCollections(db); await clearTestCollections(copy); });
beforeEach(async () => {
  await clearTestCollections(db);
  const now = new Date();
  for (const id of [owner, other]) await db.put('users', { id, displayName: 'Synthetic', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Import', type: 'banco', openingBalance: '1000.00', openingDate: '2020-01-01' })).id);
  category = String((await saveCategory(db, owner, randomUUID(), { name: 'Import', color: '#336699' })).id);
  foreign = String((await saveAccount(db, other, randomUUID(), { name: 'Foreign', type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' })).id);
  card = String((await saveCard(db, owner, randomUUID(), { name: 'Card', paymentAccountId: account, closingDay: 25, dueDay: 5 })).id);
});
afterAll(async () => { await clearTestCollections(db); await clearTestCollections(copy); await db.firestore.terminate(); await copy.firestore.terminate(); });
const csv = (rows = '2026-10-01;Mercado;-10.25', name = 'extrato.csv') => ({ name, mime: 'text/csv', bytes: new TextEncoder().encode('data;descricao;valor\n' + rows) });
async function staged(file = csv(), target: {accountId:string|null;cardId:string|null} = { accountId: account, cardId: null }) {
  const received = await receiveImports(db, owner, randomUUID(), [file], target);
  const item = (received.batches as { id: string; revision: string }[])[0]!;
  return processImport(db, owner, item.id, item.revision);
}
async function reviewed(batch: ImportBatchView, patches: Record<string, unknown>[] = []) {
  for (const [i, row] of batch.rows.entries()) await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: row.description ?? 'Corrigido', amount: row.amount ?? '-1.00', purchaseDate: row.purchaseDate ?? '2026-10-01', competenceMonth: row.competenceMonth ?? '2026-10-01', categoryId: category, selected: true, resolution: 'new', duplicateId: null, ...patches[i] });
  return loadImport(db, owner, batch.id);
}
const confirm = (batch: ImportBatchView, store = db, key = randomUUID()) => confirmImport(store, owner, key, batch.id, batch.revision, { confirmed: true });
it('stages multi-file uploads and provenance without changing any financial totals, and selects only saved valid rows', async () => {
  const received = await receiveImports(db, owner, randomUUID(), [csv('2026-10-01;Mercado;-10.25\ninvalid;;bad'), csv('2026-10-02;Salário;20')], { accountId: account, cardId: null });
  expect(received.batches).toHaveLength(2); expect(await db.owned('transactions', owner)).toHaveLength(0);
  const first = (received.batches as { id: string; revision: string }[])[0]!, batch = await processImport(db, owner, first.id, first.revision);
  expect(batch.rows.map(r => r.state)).toEqual(['pending', 'invalid']); expect(batch.rows[0]!.provenance).toMatchObject({ row: 2, cell: 'C2' });
  const reviewedBatch = await reviewed(batch, [{}, { selected: false }]); expect(reviewedBatch.preview).toEqual([{ month: '2026-10', income: '0.00', expenses: '10.25', balance: '-10.25' }]);
  expect(await db.owned('transactions', owner)).toHaveLength(0); await confirm(reviewedBatch);
  const rows = await db.owned('transactions', owner); expect(rows).toHaveLength(1); expect(accountBalances([(await db.get('accounts', account))!], rows, '2026-10-31').get(account)).toBe(98975n);
});
it('commits one time under concurrent clicks with same and different idempotency keys', async () => {
  const batch = await reviewed(await staged()), key = randomUUID();
  const results = await Promise.all([confirm(batch, db, key), confirm(batch, db, key), confirm(batch)]);
  expect(results.every(r => r.id === batch.id)).toBe(true); expect(await db.owned('transactions', owner)).toHaveLength(1);
  await expect(confirmImport(db, owner, key, batch.id, 'different', { confirmed: true })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
});
it('reimporting the same file links the existing spend, preserves references on undo, and allows final owner undo after links are removed', async () => {
  const first = await reviewed(await staged()); await confirm(first);
  const second = await reviewed(await staged(csv(undefined, 'renamed.txt'))); expect(second.rows[0]!.candidates[0]!.exact).toBe(true); expect(second.preview).toEqual([]); await confirm(second);
  expect(await db.owned('transactions', owner)).toHaveLength(1);
  const linked = await loadImport(db, owner, second.id); await undoImport(db, owner, randomUUID(), linked.id, linked.revision, { confirmed: true });
  expect((await db.owned('transactions', owner))[0]!.archivedAt).toBeNull();
  const original = await loadImport(db, owner, first.id); await undoImport(db, owner, randomUUID(), original.id, original.revision, { confirmed: true });
  expect((await db.owned('transactions', owner))[0]!.archivedAt).not.toBeNull();
});
it('undo preserves spends still referenced by another confirmed batch', async () => {
  const first = await reviewed(await staged()); await confirm(first); const second = await reviewed(await staged()); await confirm(second);
  const current = await loadImport(db, owner, first.id); const result = await undoImport(db, owner, randomUUID(), first.id, current.revision, { confirmed: true });
  expect(result).toMatchObject({ archived: 0, preserved: 1 }); expect((await db.owned('transactions', owner))[0]!.archivedAt).toBeNull(); expect((await loadImport(db, owner, first.id)).rows[0]!.undoReason).toContain('outras importações');
});
it('distinct files with equal purchases remain candidates and can be explicitly created or linked', async () => {
  const first = await reviewed(await staged()); await confirm(first);
  const second = await reviewed(await staged(csv('2026-10-01;Mercado;-10.25\n'))); expect(second.rows[0]!.candidates[0]!.exact).toBe(false); await confirm(second); expect(await db.owned('transactions', owner)).toHaveLength(2);
  const third = await staged(csv('2026-10-01;Mercado;-10.25\n\n')); const target = third.rows[0]!.candidates[0]!.id;
  await confirm(await reviewed(third, [{ resolution: 'link', duplicateId: target }])); expect(await db.owned('transactions', owner)).toHaveLength(2);
});
it('serializes concurrent cross-batch imports of identical files', async () => {
  const a = await reviewed(await staged()), b = await reviewed(await staged()); await Promise.all([confirm(a), confirm(b)]); expect(await db.owned('transactions', owner)).toHaveLength(1);
  expect((await db.owned('transactions', owner))[0]!.importReferences).toHaveLength(2);
});
it('rejects same FITID with conflicting amount and repeated identities within a file instead of silently discarding', async () => {
  const ofx = '<OFX><CURDEF>BRL\n<BANKID>1\n<ACCTID>2\n<STMTTRN><TRNAMT>-10.25\n<DTPOSTED>20261001\n<FITID>A\n<NAME>Mercado\n</STMTTRN></OFX>';
  await confirm(await reviewed(await staged({ ...csv(), bytes: new TextEncoder().encode(ofx) })));
  const conflict = await reviewed(await staged({ ...csv(), bytes: new TextEncoder().encode(ofx.replace('-10.25', '-11.00')) })); await expect(confirm(conflict)).rejects.toMatchObject({ code: 'DUPLICATE_CONFLICT' }); expect(await db.owned('transactions', owner)).toHaveLength(1);
  const repeated = ofx.replace('</OFX>', ofx.match(/<STMTTRN>.*?\/STMTTRN>/s)![0] + '</OFX>'); const batch = await reviewed(await staged({ ...csv(), bytes: new TextEncoder().encode(repeated) })); await expect(confirm(batch)).rejects.toMatchObject({ code: 'DUPLICATE_SELECTION' });
});
it('rolls back every financial row and item after a mid-write failure and can retry the same operation', async () => {
  const batch = await reviewed(await staged(csv('2026-10-01;Um;-10\n2026-10-02;Dois;-20'))), key = randomUUID();
  class FailingStore extends DocumentStore {
    override transaction<R>(callback: (tx: Database) => Promise<R>): Promise<R> {
      return super.transaction(tx => callback(new Proxy(tx, { get(target, prop) {
        if (prop === 'putMany') return async <K extends Collection>(collection: K, rows: Models[K][]) => { for (const [index, row] of rows.entries()) { if (collection === 'transactions' && index === 1) throw new Error('synthetic write failure'); await target.put(collection, row); } };
        const value = Reflect.get(target, prop); return typeof value === 'function' ? value.bind(target) : value;
      } })));
    }
  }
  await expect(confirm(batch, new FailingStore(db.firestore), key)).rejects.toThrow('synthetic'); expect(await db.owned('transactions', owner)).toHaveLength(0); expect((await loadImport(db, owner, batch.id)).state).toBe('review'); await confirm(batch, db, key); expect(await db.owned('transactions', owner)).toHaveLength(2);
});
it('undo after manual edit preserves new amount and description while archiving untouched lines atomically', async () => {
  const batch = await reviewed(await staged(csv('2026-10-01;Um;-10\n2026-10-02;Dois;-20'))); await confirm(batch); const rows = await db.owned('transactions', owner), edited = rows.find(r => r.description === 'Um')!;
  await saveEntry(db, owner, randomUUID(), { accountId: account, categoryId: category, description: 'Editado', amount: '12.00', kind: 'expense', status: 'settled', purchaseDate: '2026-10-01', competenceMonth: '2026-10-01', dueDate: null, paidDate: '2026-10-01' }, edited.id, revision(edited));
  const current = await loadImport(db, owner, batch.id); await Promise.all([1, 2].map(() => undoImport(db, owner, randomUUID(), batch.id, current.revision, { confirmed: true })));
  expect((await db.get('transactions', edited.id))!).toMatchObject({ description: 'Editado', amount: '-12.00', archivedAt: null }); expect(monthTotals(await db.owned('transactions', owner), '2026-10').expenses).toBe(1200n);
});
it('imports card purchases and credits into invoices without settling the payment account, and undo recomputes the invoice', async () => {
  const batch = await reviewed(await staged(csv('2026-10-01;Compra;-20\n2026-10-02;Crédito;5'), { accountId: null, cardId: card })); await confirm(batch);
  const entries = await db.owned('transactions', owner); expect(monthTotals(entries, '2026-10').expenses).toBe(1500n); expect(accountBalances([(await db.get('accounts', account))!], entries, '2026-10-31').get(account)).toBe(100000n);
  expect((await loadInvoice(db, owner, card, '2026-10')).totals.computed).toBe('15.00'); const current = await loadImport(db, owner, batch.id); await undoImport(db, owner, randomUUID(), batch.id, current.revision, { confirmed: true }); expect((await loadInvoice(db, owner, card, '2026-10')).totals.computed).toBe('0.00');
});
it('cancels received/review/failed batches without side effects and refuses stale corrections, foreign reads and invalid selections', async () => {
  const batch = await staged(); await expect(loadImport(db, other, batch.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(receiveImports(db, owner, randomUUID(), [csv()], { accountId: foreign, cardId: null })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(confirm(batch)).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
  const updated = await reviewed(batch); await expect(cancelImport(db, owner, randomUUID(), batch.id, batch.revision)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' }); await cancelImport(db, owner, randomUUID(), batch.id, updated.revision);
  expect((await loadImport(db, owner, batch.id)).state).toBe('cancelled'); await expect(confirm(await loadImport(db, owner, batch.id))).rejects.toMatchObject({ code: 'BATCH_STATE' }); expect(await db.owned('transactions', owner)).toHaveLength(0);
});
it('persists actionable parser failures and permits retry while retaining staging only', async () => {
  const batch = await staged(csv('', 'empty.csv')); expect(batch.state).toBe('failed'); expect(batch.error).toContain('movimentações'); const retry = await processImport(db, owner, batch.id, batch.revision); expect(retry.state).toBe('failed'); await cancelImport(db, owner, randomUUID(), retry.id, retry.revision); expect((await db.get('importBatches', batch.id))!.payload).toBeNull();
});
it('backups preserve original provenance, review corrections, links and undo history without frozen SQL export', async () => {
  await confirm(await reviewed(await staged())); const backup = await backupFirebase(db); await restoreFirebase(copy, backup); expect(await backupFirebase(copy)).toEqual(backup);
});
it('cancellation and confirmation races produce a single coherent result with no partial spend', async () => {
  const batch = await reviewed(await staged());
  const results = await Promise.allSettled([confirm(batch), cancelImport(db, owner, randomUUID(), batch.id, batch.revision)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const current = await loadImport(db, owner, batch.id), rows = await db.owned('transactions', owner);
  expect(rows.length).toBe(current.state === 'confirmed' ? 1 : 0); expect(['confirmed', 'cancelled']).toContain(current.state);
});
it('cancelled processing cannot resurrect a review even when parsing finishes later', async () => {
  const received = await receiveImports(db, owner, randomUUID(), [csv()], { accountId: account, cardId: null });
  const batch = (received.batches as { id: string; revision: string }[])[0]!;
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), processing = new Promise<void>(resolve => { started = resolve; });
  class SlowStore extends DocumentStore {
    calls = 0;
    override async transaction<R>(callback: (tx: Database) => Promise<R>): Promise<R> {
      if (++this.calls === 2) { started(); await waiting; }
      return super.transaction(callback);
    }
  }
  const work = processImport(new SlowStore(db.firestore), owner, batch.id, batch.revision); await processing;
  const current = await loadImport(db, owner, batch.id); expect(current.state).toBe('processing');
  await cancelImport(db, owner, randomUUID(), batch.id, current.revision); release();
  expect((await work).state).toBe('cancelled'); expect((await loadImport(db, owner, batch.id)).rows).toHaveLength(0); expect(await db.owned('transactions', owner)).toHaveLength(0);
});
it('rejects changes to a closed month for both commit and undo', async () => {
  const { touchMonths } = await import('../../../apps/next/src/lib/planning-lock');
  const batch = await reviewed(await staged());
  await db.transaction(tx => touchMonths(tx, owner, ['2026-10']));
  const month = (await db.owned('planningMonths', owner))[0]!;
  await db.put('planningMonths', { ...month, closedAt: new Date() });
  await expect(confirm(batch)).rejects.toMatchObject({ code: 'MONTH_CLOSED' }); expect(await db.owned('transactions', owner)).toHaveLength(0);
  await db.put('planningMonths', { ...month, closedAt: null }); await confirm(batch);
  await db.put('planningMonths', { ...month, closedAt: new Date() }); const current = await loadImport(db, owner, batch.id);
  await expect(undoImport(db, owner, randomUUID(), batch.id, current.revision, { confirmed: true })).rejects.toMatchObject({ code: 'MONTH_CLOSED' }); expect((await db.owned('transactions', owner))[0]!.archivedAt).toBeNull();
});
it('commits and reverts the maximum 60 rows and rejects resource overflows before financial writes', async () => {
  const batch = await staged(csv(Array.from({ length: 60 }, (_, i) => `2026-10-01;Compra ${i};-0.01`).join('\n')), { accountId: null, cardId: card });
  // Seed fully reviewed rows directly to keep this resource-boundary fixture small.
  await db.transaction(async tx => {
    const items = await tx.owned('importItems', owner, { where: [{ field: 'batchId', value: batch.id }] });
    await tx.putMany('importItems', items.map(item => ({ ...item, categoryId: category, state: 'valid', selected: true, revision: randomUUID() })));
  });
  await confirm(await loadImport(db, owner, batch.id)); expect(await db.owned('transactions', owner)).toHaveLength(60);
  expect((await loadInvoice(db, owner, card, '2026-10')).totals.computed).toBe('0.60');
  const current = await loadImport(db, owner, batch.id); await undoImport(db, owner, randomUUID(), current.id, current.revision, { confirmed: true }); expect((await db.owned('transactions', owner)).filter(r => !r.archivedAt)).toHaveLength(0);
  await expect(receiveImports(db, owner, randomUUID(), Array.from({ length: 11 }, () => csv()), { accountId: account, cardId: null })).rejects.toMatchObject({ code: 'FILE_COUNT' });
  await expect(receiveImports(db, owner, randomUUID(), [{ ...csv(), bytes: new Uint8Array(256 * 1024 + 1) }], { accountId: account, cardId: null })).rejects.toMatchObject({ code: 'FILE_LIMIT' });
  const broad = await reviewed(await staged(csv(Array.from({ length: 7 }, (_, i) => `2027-0${i + 1}-01;Compra;-1`).join('\n')))); await expect(confirm(broad)).rejects.toMatchObject({ code: 'COMMIT_LIMIT' });
}, 90000);
it('repeats a cancelled review and confirmed batch idempotently without duplicating spend', async () => {
  const batch=await reviewed(await staged());await cancelImport(db,owner,randomUUID(),batch.id,batch.revision);
  const cancelled=await loadImport(db,owner,batch.id),key=randomUUID();
  const results=await Promise.all([1,2].map(()=>repeatImport(db,owner,key,cancelled.id,cancelled.revision)));expect(results[0]!.id).toBe(results[1]!.id);
  const repeated=await loadImport(db,owner,String(results[0]!.id));expect(repeated.rows[0]!).toMatchObject({selected:false,provenance:batch.rows[0]!.provenance});await confirm(await reviewed(repeated));
  const current=await loadImport(db,owner,repeated.id),again=await repeatImport(db,owner,randomUUID(),current.id,current.revision);await confirm(await reviewed(await loadImport(db,owner,String(again.id))));expect(await db.owned('transactions',owner)).toHaveLength(1);
});
it('repeating a reverted card batch restores only the untouched undo archive and recalculates every invoice item',async()=>{
  const batch=await reviewed(await staged(csv('2026-10-01;Compra;-20\n2026-10-02;Crédito;5'),{accountId:null,cardId:card}));await confirm(batch);
  let current=await loadImport(db,owner,batch.id);await undoImport(db,owner,randomUUID(),current.id,current.revision,{confirmed:true});current=await loadImport(db,owner,batch.id);
  const result=await repeatImport(db,owner,randomUUID(),current.id,current.revision),repeated=await reviewed(await loadImport(db,owner,String(result.id)));
  expect(repeated.preview).toEqual([{month:'2026-10',income:'0.00',expenses:'15.00',balance:'0.00'}]);await confirm(repeated);expect(await db.owned('transactions',owner)).toHaveLength(2);expect((await loadInvoice(db,owner,card,'2026-10')).totals.computed).toBe('15.00');
});
it('repeating after a manual archive does not restore or overwrite the later manual decision',async()=>{
  const batch=await reviewed(await staged());await confirm(batch);let current=await loadImport(db,owner,batch.id);await undoImport(db,owner,randomUUID(),current.id,current.revision,{confirmed:true});
  let entry=(await db.owned('transactions',owner))[0]!;await archiveEntry(db,owner,randomUUID(),entry.id,revision(entry),false);entry=(await db.get('transactions',entry.id))!;await archiveEntry(db,owner,randomUUID(),entry.id,revision(entry),true);
  current=await loadImport(db,owner,batch.id);const repeated=await repeatImport(db,owner,randomUUID(),current.id,current.revision);await expect(confirm(await reviewed(await loadImport(db,owner,String(repeated.id))))).rejects.toMatchObject({code:'DUPLICATE_CONFLICT'});expect((await db.get('transactions',entry.id))!.archivedAt).not.toBeNull();
});
it('an explicit link never restores a transaction archived after its review or changes the zero-impact preview', async () => {
  const original = await reviewed(await staged()); await confirm(original);
  const entry = (await db.owned('transactions', owner))[0]!;
  const linked = await reviewed(await staged(), [{ resolution: 'link', duplicateId: entry.id }]);
  expect(linked.preview).toEqual([]);
  const current = await loadImport(db, owner, original.id);
  await undoImport(db, owner, randomUUID(), current.id, current.revision, { confirmed: true });
  await expect(confirm(linked)).rejects.toMatchObject({ code: 'DUPLICATE_CONFLICT' });
  expect((await db.get('transactions', entry.id))!.archivedAt).not.toBeNull();
  expect((await loadImport(db, owner, linked.id)).state).toBe('review');
});
it('keeps import staging separate from metrics and refreshes confirmed reports and balances after commit and undo', async () => {
  const { loadReport } = await import('../../../apps/next/src/lib/metrics-read');
  const report = () => loadReport(owner, { from: '2026-10', to: '2026-10', basis: 'competence' }, new Date('2026-10-31T15:00:00Z'), db);
  const initial = await report();
  const batch = await reviewed(await staged(csv('2026-10-01;Mercado;-10.25\n2026-10-02;Salário;20')));
  expect(batch.preview).toEqual([{ month: '2026-10', income: '20.00', expenses: '10.25', balance: '9.75' }]);
  expect((await report()).report.totals).toEqual(initial.report.totals);
  expect((await report()).projection.balance).toBe('1000.00');
  await confirm(batch);
  const committed = await report();
  expect(committed.report.totals).toMatchObject({ income: '20.00', expenses: '10.25', net: '9.75', count: 2 });
  expect(committed.projection.balance).toBe('1009.75');
  const current = await loadImport(db, owner, batch.id);
  await undoImport(db, owner, randomUUID(), current.id, current.revision, { confirmed: true });
  const reverted = await report();
  expect(reverted.report.totals).toEqual(initial.report.totals);
  expect(reverted.projection.balance).toBe('1000.00');
});
