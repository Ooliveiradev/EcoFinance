import { beforeAll, beforeEach, afterAll, afterEach, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { saveAccount, saveCategory } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard } from '../../../apps/next/src/lib/card-store';
import { receiveImports, processImport, loadImport, reviewImportItem, cancelImport } from '../../../apps/next/src/lib/import-store';
import { confirmImport } from '../../../apps/next/src/lib/import-commit';
import { documentJobsIdle } from '../../../apps/next/src/lib/import-jobs';
import { moneyToCents, centsToMoney, type ImportBatchView } from '../../shared/src';
import { documentBytes, documentCorpus, DOCUMENT_PASSWORD } from '../../../tests/fixtures/documents/corpus';

// OCR of the whole corpus takes tens of seconds on CI runners.
vi.setConfig({ testTimeout: 240_000 });
const db = testStore('import-documents-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000010';
let account: string, card: string, category: string;
const env = { ...process.env };
beforeAll(async () => { await clearTestCollections(db); });
beforeEach(async () => {
  process.env.IMPORT_OCR = 'on';
  await clearTestCollections(db);
  const now = new Date();
  await db.put('users', { id: owner, displayName: 'Synthetic', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Documentos', type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' })).id);
  card = String((await saveCard(db, owner, randomUUID(), { name: 'Cartão Exemplo', paymentAccountId: account, closingDay: 25, dueDay: 5 })).id);
  category = String((await saveCategory(db, owner, randomUUID(), { name: 'Documentos', color: '#336699' })).id);
});
afterEach(async () => { await documentJobsIdle(); process.env = { ...env }; });
afterAll(async () => { await clearTestCollections(db); await db.firestore.terminate(); });

async function receive(name: string, target: 'account' | 'card' = 'account') {
  const entry = documentCorpus.find(item => item.file === name)!;
  const received = await receiveImports(db, owner, randomUUID(), [{ name, mime: entry.mime, bytes: await documentBytes(name) }], { accountId: target === 'account' ? account : null, cardId: target === 'card' ? card : null });
  return (received.batches as { id: string; revision: string }[])[0]!;
}
/** Starts the analysis; the request returns while the worker runs, then the test waits for it. */
async function analyse(name: string, target: 'account' | 'card' = 'account', password?: string) {
  const received = await receive(name, target);
  const started = await processImport(db, owner, received.id, received.revision, password ? { password } : {});
  await documentJobsIdle();
  return { started, batch: await loadImport(db, owner, received.id) };
}
async function confirmAll(batch: ImportBatchView, exclude: (row: ImportBatchView['rows'][number]) => boolean = () => false) {
  for (const row of batch.rows.filter(row => row.state === 'pending'))
    await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: row.description, amount: row.amount, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, categoryId: category, selected: !exclude(row), resolution: exclude(row) ? 'exclude' : 'new', duplicateId: null });
  const reviewed = await loadImport(db, owner, batch.id);
  return confirmImport(db, owner, randomUUID(), batch.id, reviewed.revision, { confirmed: true });
}
const readable = documentCorpus.filter(entry => !entry.error);

it('analyses PDFs and images off the request and stages rows with page, region and excerpt before any money moves', async () => {
  expect(readable).toHaveLength(11);
  for (const entry of readable) {
    const { started, batch } = await analyse(entry.file, entry.target, entry.password);
    // The request only claims the batch; extraction happens in the document worker.
    expect([entry.file, started.state, started.rows.length, started.progress?.phase]).toEqual([entry.file, 'processing', 0, 'queued']);
    expect([entry.file, batch.state, batch.format, batch.document?.kind, batch.progress]).toEqual([entry.file, 'review', entry.format, entry.kind, null]);
    expect(batch.rows.map(row => [row.amount, row.purchaseDate, row.description, row.provenance.page])).toEqual(entry.rows);
    expect(batch.rows.every(row => row.state === 'pending' && !!row.provenance.region && !!row.provenance.excerpt)).toBe(true);
    for (const warning of entry.warnings ?? []) expect(batch.rows[0]!.warnings.join('\n').replace(/\u00a0/g, ' ')).toContain(warning);
  }
  expect(await db.owned('transactions', owner)).toHaveLength(0);
});
it('confirms a digital statement and a scanned invoice into the same ledger as structured imports', async () => {
  const statement = (await analyse('extrato-digital.pdf')).batch;
  await confirmAll(statement);
  const invoice = (await analyse('fatura-digital.pdf', 'card')).batch;
  // The previous invoice payment is evidence, not a refund: the user excludes it.
  await confirmAll(invoice, row => row.description === 'Pagamento recebido');
  const rows = await db.owned('transactions', owner);
  expect(rows).toHaveLength(6 + 8);
  expect(new Set(rows.map(row => row.source))).toEqual(new Set(['document']));
  expect(centsToMoney(rows.filter(row => !row.invoiceId).reduce((sum, row) => sum + moneyToCents(row.amount), 0n))).toBe('3437.85');
  expect(centsToMoney(rows.filter(row => row.invoiceId).reduce((sum, row) => sum + moneyToCents(row.amount), 0n))).toBe('-787.55');
});
it('fails with actionable diagnostics and no rows for illegible, empty, corrupt, oversized and unsupported documents', async () => {
  for (const entry of documentCorpus.filter(item => item.error)) {
    const { batch } = await analyse(entry.file);
    expect([entry.file, batch.state, batch.rows.length]).toEqual([entry.file, 'failed', 0]);
    expect(batch.error!.length).toBeGreaterThan(30);
  }
  expect(await db.owned('importItems', owner)).toHaveLength(0);
});
it('uses a PDF password only for the run that receives it and never stores it', async () => {
  const received = await receive('extrato-protegido.pdf');
  await processImport(db, owner, received.id, received.revision); await documentJobsIdle();
  let batch = await loadImport(db, owner, received.id);
  expect([batch.state, batch.document?.passwordRequired]).toEqual(['failed', true]);
  expect(batch.error).toContain('Informe a senha');
  await processImport(db, owner, batch.id, batch.revision, { password: 'Senha-Errada-0000' }); await documentJobsIdle();
  batch = await loadImport(db, owner, received.id);
  expect([batch.state, batch.document?.passwordRequired, batch.error]).toEqual(['failed', true, 'Senha incorreta. Confira e informe a senha do PDF novamente.']);
  await processImport(db, owner, batch.id, batch.revision, { password: DOCUMENT_PASSWORD }); await documentJobsIdle();
  batch = await loadImport(db, owner, received.id);
  expect([batch.state, batch.rows.length, batch.document?.passwordRequired]).toEqual(['review', 4, false]);
  const stored = JSON.stringify([await db.owned('importBatches', owner), await db.owned('importItems', owner), (await db.firestore.collection('operations').get()).docs.map(doc => doc.data())]);
  expect(stored).not.toContain(DOCUMENT_PASSWORD); expect(stored).not.toContain('Senha-Errada-0000');
  // Structured files never accept a password.
  const csv = await receiveImports(db, owner, randomUUID(), [{ name: 'a.csv', mime: 'text/csv', bytes: Buffer.from('Data;Descrição;Valor\n01/10/2026;Café;-5,00\n') }], { accountId: account, cardId: null });
  const target = (csv.batches as { id: string; revision: string }[])[0]!;
  await expect(processImport(db, owner, target.id, target.revision, { password: 'x' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(processImport(db, owner, target.id, target.revision, { password: 'x', other: 1 })).rejects.toThrow();
});
it('cancels a running analysis without staging rows and lets an abandoned job be claimed again', async () => {
  const received = await receive('extrato-escaneado.pdf');
  const started = await processImport(db, owner, received.id, received.revision);
  expect(started.state).toBe('processing');
  // Progress checkpoints keep the revision shown on screen valid for cancellation.
  await new Promise(resolve => setTimeout(resolve, 1500));
  expect((await loadImport(db, owner, received.id)).revision).toBe(started.revision);
  await cancelImport(db, owner, randomUUID(), received.id, started.revision);
  await documentJobsIdle();
  expect(await loadImport(db, owner, received.id)).toMatchObject({ state: 'cancelled', rows: [], progress: null });
  const other = await receive('extrato.webp');
  const first = await processImport(db, owner, other.id, other.revision);
  // A second claim (e.g. "Repetir análise" after an instance restart) supersedes the first job.
  const second = await processImport(db, owner, other.id, first.revision);
  await documentJobsIdle();
  const done = await loadImport(db, owner, other.id);
  expect([second.state, done.state, done.rows.length]).toEqual(['processing', 'review', 4]);
  expect(await db.owned('importItems', owner)).toHaveLength(4);
});
it('degrades without OCR and enforces the document size limit at upload', async () => {
  process.env.IMPORT_OCR = 'off';
  expect((await analyse('extrato-digital.pdf')).batch.state).toBe('review');
  const scan = (await analyse('extrato-escaneado.pdf')).batch;
  expect([scan.state, scan.rows.length]).toEqual(['failed', 0]); expect(scan.error).toContain('OCR está desativado');
  const big = new Uint8Array(300 * 1024); big.set(Buffer.from('%PDF-1.4\n'));
  await expect(receiveImports(db, owner, randomUUID(), [{ name: 'grande.pdf', mime: 'application/pdf', bytes: big }], { accountId: account, cardId: null })).resolves.toBeTruthy();
  await expect(receiveImports(db, owner, randomUUID(), [{ name: 'grande.csv', mime: 'text/csv', bytes: new Uint8Array(300 * 1024).fill(65) }], { accountId: account, cardId: null })).rejects.toMatchObject({ code: 'FILE_LIMIT' });
  const huge = new Uint8Array(513 * 1024); huge.set(Buffer.from('%PDF-1.4\n'));
  await expect(receiveImports(db, owner, randomUUID(), [{ name: 'enorme.pdf', mime: 'application/pdf', bytes: huge }], { accountId: account, cardId: null })).rejects.toMatchObject({ code: 'FILE_LIMIT', status: 413 });
});
