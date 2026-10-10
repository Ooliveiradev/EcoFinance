import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { saveAccount, saveCategory } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard } from '../../../apps/next/src/lib/card-store';
import { receiveImports, processImport, loadImport, reviewImportItem, cancelImport } from '../../../apps/next/src/lib/import-store';
import { confirmImport } from '../../../apps/next/src/lib/import-commit';
import { invoicePages, picture, protectedPdf, receiptPage, scannedInvoicePage, scannedPdf, textPdf } from '../../../tests/fixtures/documents/build';

/** PDF/image batches (#10) through staging, review and commit on the Firestore emulator. */
const db = testStore('import-documents-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001';
let account: string, card: string, category: string;
beforeAll(async () => { await clearTestCollections(db); });
beforeEach(async () => {
  await clearTestCollections(db);
  const now = new Date();
  await db.put('users', { id: owner, displayName: 'Synthetic', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Documentos', type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' })).id);
  card = String((await saveCard(db, owner, randomUUID(), { name: 'Cartão', paymentAccountId: account, closingDay: 25, dueDay: 5 })).id);
  category = String((await saveCategory(db, owner, randomUUID(), { name: 'Documentos', color: '#336699' })).id);
});
afterAll(async () => { await clearTestCollections(db); await db.firestore.terminate(); });
async function stage(name: string, mime: string, bytes: Uint8Array, target: { accountId: string | null; cardId: string | null }) {
  const received = await receiveImports(db, owner, randomUUID(), [{ name, mime, bytes }], target);
  return (received.batches as { id: string; revision: string }[])[0]!;
}

it('stages a digital invoice on a card, keeps page evidence and commits only reviewed rows', async () => {
  const staged = await stage('fatura.pdf', 'application/pdf', await textPdf(invoicePages), { accountId: null, cardId: card });
  const batch = await processImport(db, owner, staged.id, staged.revision);
  expect(batch).toMatchObject({ state: 'review', format: 'PDF digital · fatura de cartão', errorCode: null, progress: null });
  expect(batch.rows.map(row => [row.amount, row.provenance.page])).toEqual([['-89.90', 1], ['-123.45', 1], ['-1234.56', 1], ['50.00', 2], ['-200.00', 2]]);
  expect(batch.rows.every(row => row.state === 'pending' && !row.selected && row.provenance.region)).toBe(true);
  expect(batch.rows[0]!.warnings.join(' ')).toContain('Soma das linhas confere');
  expect(await db.owned('transactions', owner)).toHaveLength(0);
  const row = batch.rows[1]!;
  await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: row.description, amount: row.amount, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, categoryId: category, selected: true, resolution: 'new', duplicateId: null });
  await confirmImport(db, owner, randomUUID(), batch.id, (await loadImport(db, owner, batch.id)).revision, { confirmed: true });
  const entries = await db.owned('transactions', owner);
  expect(entries.map(entry => [entry.amount, entry.description, entry.cardEntryType])).toEqual([['-123.45', 'MERCADO BOM PRECO', 'purchase']]);
});
it('warns when a receipt or invoice is sent to an unexpected target, without changing balances', async () => {
  const staged = await stage('fatura.pdf', 'application/pdf', await textPdf(invoicePages), { accountId: account, cardId: null });
  const batch = await processImport(db, owner, staged.id, staged.revision);
  expect(batch.rows[0]!.warnings.join(' ')).toContain('parece uma fatura de cartão, mas o destino é uma conta');
  const receipt = await stage('comprovante.png', 'image/png', await picture(receiptPage, 'png'), { accountId: account, cardId: null });
  const read = await processImport(db, owner, receipt.id, receipt.revision);
  expect(read.rows.map(r => [r.amount, r.purchaseDate, r.description])).toEqual([['-27.50', '2026-10-03', 'PADARIA EXEMPLO LTDA']]);
  expect(await db.owned('transactions', owner)).toHaveLength(0);
}, 60_000);
it('asks for a PDF password per analysis and never stores it', async () => {
  const pdfKey = 'segredo-' + randomBytes(4).toString('hex');
  const staged = await stage('protegido.pdf', 'application/pdf', protectedPdf(['FATURA DO CARTAO', 'Vencimento 10/10/2026', 'Data Descricao Valor', '12/09 MERCADO EXEMPLO 45,90'], pdfKey), { accountId: null, cardId: card });
  const locked = await processImport(db, owner, staged.id, staged.revision);
  expect(locked).toMatchObject({ state: 'failed', errorCode: 'PASSWORD_REQUIRED', format: 'PDF' });
  const wrong = await processImport(db, owner, staged.id, locked.revision, { password: 'errada' });
  expect(wrong).toMatchObject({ state: 'failed', errorCode: 'PASSWORD_INVALID' });
  await expect(processImport(db, owner, staged.id, wrong.revision, { password: '', extra: 1 })).rejects.toThrow();
  const open = await processImport(db, owner, staged.id, wrong.revision, { password: pdfKey });
  expect(open).toMatchObject({ state: 'review', errorCode: null });
  expect(open.rows.map(row => row.amount)).toEqual(['-45.90']);
  const stored = JSON.stringify([await db.get('importBatches', staged.id), await db.owned('importItems', owner), await db.owned('operations', owner)]);
  expect(stored).not.toContain(pdfKey);
}, 60_000);
it('records page progress without changing the revision and stops OCR when cancelled', async () => {
  const staged = await stage('escaneada.pdf', 'application/pdf', await scannedPdf([scannedInvoicePage, scannedInvoicePage, scannedInvoicePage]), { accountId: null, cardId: card });
  const work = processImport(db, owner, staged.id, staged.revision);
  let current = await loadImport(db, owner, staged.id);
  for (let i = 0; i < 200 && !current.progress; i++) { await new Promise(resolve => setTimeout(resolve, 50)); current = await loadImport(db, owner, staged.id); }
  expect(current.state).toBe('processing'); expect(current.progress).toMatchObject({ pages: 3 }); expect(current.revision).toBe((await loadImport(db, owner, staged.id)).revision);
  const started = Date.now();
  await cancelImport(db, owner, randomUUID(), staged.id, current.revision);
  const finished = await work;
  expect(finished.state).toBe('cancelled'); expect(finished.rows).toHaveLength(0); expect(finished.progress).toBeNull();
  // The worker is terminated at the next check instead of reading the remaining pages.
  expect(Date.now() - started).toBeLessThan(5000);
}, 60_000);
