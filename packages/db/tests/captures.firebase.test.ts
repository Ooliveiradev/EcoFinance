import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { saveAccount, saveCategory } from '../../../apps/next/src/lib/manual-finance-service';
import { loadImport, reviewImportItem } from '../../../apps/next/src/lib/import-store';
import { confirmImport } from '../../../apps/next/src/lib/import-commit';
import { captureSources, receiveCaptures, saveCaptureSources } from '../../../apps/next/src/lib/capture-store';
import type { CaptureEvent, ImportBatchView } from '../../shared/src';

/** Optional expense capture (#19): notices become review rows; only confirmation records an expense. */
const db = testStore('captures-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';
const device = '20000000-0000-4000-8000-000000000001', bank = 'com.exemplo.banco';
let account: string, food: string;
beforeAll(async () => { await clearTestCollections(db); });
beforeEach(async () => {
  await clearTestCollections(db);
  const now = new Date();
  for (const id of [owner, other]) await db.put('users', { id, displayName: 'Synthetic', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Conta captura', type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' })).id);
  food = String((await saveCategory(db, owner, randomUUID(), { name: 'Alimentação', color: '#336699' })).id);
});
afterAll(async () => { await clearTestCollections(db); await db.firestore.terminate(); });
let sequence = 0;
const notice = (text: string, extra: Partial<CaptureEvent> = {}): CaptureEvent => ({ package: bank, key: `0|${bank}|${++sequence}|null|10001`, postedAt: '2026-10-29T15:30:00-03:00', title: 'Banco Exemplo', text, ...extra });
const enable = (who = owner, target = account) => saveCaptureSources(db, who, randomUUID(), { sources: [{ package: bank, label: 'Banco Exemplo', accountId: target, cardId: null }] });
const send = (events: CaptureEvent[], key = randomUUID(), who = owner) => receiveCaptures(db, who, key, { deviceId: device, events });
const transactions = async (who = owner) => (await db.owned('transactions', who)).filter(row => !row.archivedAt);
async function batchOf(result: { batches: unknown }): Promise<ImportBatchView> {
  const [first] = result.batches as { id: string }[];
  return loadImport(db, owner, first!.id);
}
async function save(batch: ImportBatchView, position: number, patch: Record<string, unknown> = {}) {
  const row = batch.rows.find(item => item.position === position)!;
  await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: row.description ?? 'Preenchido', amount: row.amount ?? '-1.00', purchaseDate: row.purchaseDate!, competenceMonth: row.competenceMonth!, categoryId: food, selected: true, resolution: 'new', duplicateId: null, ...patch });
  return loadImport(db, owner, batch.id);
}

it('ignores every notice until the user enables the app with an explicit account', async () => {
  const result = await send([notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.')]);
  expect(result).toMatchObject({ batches: [], accepted: 0, ignored: { 'app não habilitado': 1 } });
  await expect(saveCaptureSources(db, owner, randomUUID(), { sources: [{ package: bank, label: 'Banco', accountId: randomUUID(), cardId: null }] })).rejects.toMatchObject({ status: 404 });
  expect(await captureSources(db, owner)).toEqual([]);
});

it('stages eligible notices for review and keeps totals unchanged until confirmation', async () => {
  await enable();
  const result = await send([
    notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.'),
    notice('Compra de R$ 42,90 RECUSADA em MERCADO EXEMPLO.'),
    notice('Seu código de verificação é 123456.'),
    notice('Pagamento da fatura de R$ 900,00 recebido.'),
    notice('Pix enviado: R$ 50,00 para FULANO SINTETICO.'),
    notice('Novidade no app!'),
  ]);
  expect(result).toMatchObject({ accepted: 2, repeated: 0, ignored: { 'compra recusada ou cancelada': 1, 'código ou dado sensível': 1, 'pagamento de fatura': 1, 'aviso não financeiro': 1 } });
  const batch = await batchOf(result);
  expect(batch).toMatchObject({ state: 'review', accountId: account, cardId: null, format: 'Notificação Android (generic-ptbr@1)' });
  expect(batch.rows.map(row => [row.description, row.amount, row.state, row.selected])).toEqual([['MERCADO EXEMPLO', '-42.90', 'pending', false], ['FULANO SINTETICO', '-50.00', 'pending', false]]);
  expect(batch.rows[0]!.provenance.excerpt).toContain('R$ 42,90');
  expect(batch.rows[1]!.warnings.join(' ')).toContain('entre contas suas');
  // The code and the declined purchase were never stored.
  expect(JSON.stringify(await db.owned('importItems', owner))).not.toContain('123456');
  expect(await transactions()).toHaveLength(0);
  const reviewed = await save(batch, 1);
  await confirmImport(db, owner, randomUUID(), reviewed.id, reviewed.revision, { confirmed: true });
  expect((await transactions()).map(row => [row.description, row.amount, row.source, row.kind])).toEqual([['MERCADO EXEMPLO', '-42.90', 'notification', 'expense']]);
});

it('skips repeated notices across retries and replays, and confirms at most one expense', async () => {
  await enable();
  const purchase = notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.'), key = randomUUID();
  const first = await send([purchase], key);
  expect(await send([purchase], key)).toEqual(first);
  expect(await send([purchase, purchase])).toMatchObject({ batches: [], accepted: 0, repeated: 2 });
  const reviewed = await save(await batchOf(first), 1);
  const confirms = await Promise.allSettled([1, 2].map(() => confirmImport(db, owner, randomUUID(), reviewed.id, reviewed.revision, { confirmed: true })));
  expect(confirms.some(result => result.status === 'fulfilled')).toBe(true);
  expect(await transactions()).toHaveLength(1);
});

it('keeps two legitimate purchases with the same value and merchant', async () => {
  await enable();
  const result = await send([notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.'), notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.')]);
  let batch = await batchOf(result);
  expect(batch.rows).toHaveLength(2);
  batch = await save(batch, 1); batch = await save(batch, 2);
  await confirmImport(db, owner, randomUUID(), batch.id, batch.revision, { confirmed: true });
  expect((await transactions()).map(row => row.amount)).toEqual(['-42.90', '-42.90']);
});

it('leaves fields without evidence empty and the row invalid until the user fills them', async () => {
  await enable();
  const batch = await batchOf(await send([notice('Compra aprovada no seu cartão.')]));
  expect(batch.rows[0]).toMatchObject({ description: null, amount: null, state: 'invalid' });
  await expect(confirmImport(db, owner, randomUUID(), batch.id, batch.revision, { confirmed: true })).rejects.toMatchObject({ status: 400 });
  expect(await transactions()).toHaveLength(0);
});

it('isolates sources, batches and notices between users and stops when the app is removed', async () => {
  await enable();
  const mine = await send([notice('Compra de R$ 10,00 aprovada em PADARIA TESTE.')]);
  expect(await captureSources(db, other)).toEqual([]);
  expect(await send([notice('Compra de R$ 10,00 aprovada em PADARIA TESTE.')], randomUUID(), other)).toMatchObject({ accepted: 0, ignored: { 'app não habilitado': 1 } });
  await expect(loadImport(db, other, (mine.batches as { id: string }[])[0]!.id)).rejects.toMatchObject({ status: 404 });
  // Another user cannot point a source at this user's account.
  await expect(enable(other, account)).rejects.toMatchObject({ status: 404 });
  await saveCaptureSources(db, owner, randomUUID(), { sources: [] });
  expect(await send([notice('Compra de R$ 11,00 aprovada em PADARIA TESTE.')])).toMatchObject({ accepted: 0, ignored: { 'app não habilitado': 1 } });
});
