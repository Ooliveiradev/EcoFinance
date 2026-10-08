import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { saveAccount, saveCategory } from '../../../apps/next/src/lib/manual-finance-service';
import { receiveImports, processImport, loadImport, reviewImportItem, mapImport } from '../../../apps/next/src/lib/import-store';
import { confirmImport } from '../../../apps/next/src/lib/import-commit';
import { moneyToCents, centsToMoney, type ImportBatchView } from '../../shared/src';
import { corpus, corpusBytes, mapping } from '../../../tests/fixtures/imports/corpus';

const db = testStore('import-formats-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001';
let account: string, category: string;
beforeAll(async () => { await clearTestCollections(db); });
beforeEach(async () => {
  await clearTestCollections(db);
  const now = new Date();
  await db.put('users', { id: owner, displayName: 'Synthetic', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Formatos', type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' })).id);
  category = String((await saveCategory(db, owner, randomUUID(), { name: 'Formatos', color: '#336699' })).id);
});
afterAll(async () => { await clearTestCollections(db); await db.firestore.terminate(); });
const fileOf = (name: string, rename = name) => ({ name: rename, mime: corpus.find(entry => entry.file === name)!.mime, bytes: corpusBytes(name) });
async function upload(names: string[]) {
  const received = await receiveImports(db, owner, randomUUID(), names.map(name => fileOf(name)), { accountId: account, cardId: null });
  // Sequential on purpose: concurrent analyses of one owner contend on the emulator lock.
  const batches: ImportBatchView[] = [];
  for (const batch of received.batches as { id: string; revision: string }[]) batches.push(await processImport(db, owner, batch.id, batch.revision));
  return batches;
}
async function confirmValid(batch: ImportBatchView) {
  for (const row of batch.rows.filter(row => row.state === 'pending'))
    await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: row.description, amount: row.amount, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, categoryId: category, selected: true, resolution: 'new', duplicateId: null });
  const reviewed = await loadImport(db, owner, batch.id);
  return confirmImport(db, owner, randomUUID(), batch.id, reviewed.revision, { confirmed: true });
}
const direct = corpus.filter(entry => !entry.error && !entry.mappingRequired);

it('stages every directly recognized format with exact rows and cell/line provenance before any money moves', async () => {
  expect(direct).toHaveLength(10);
  const batches = await upload(direct.map(entry => entry.file));
  for (const [index, batch] of batches.entries()) {
    const entry = direct[index]!;
    expect([entry.file, batch.state, batch.format]).toEqual([entry.file, 'review', entry.format ?? expect.any(String)]);
    expect(batch.rows.map(row => [row.amount, row.purchaseDate, row.description, row.provenance.cell ?? row.provenance.row])).toEqual(entry.rows);
    expect(batch.rows.filter(row => row.state === 'pending')).toHaveLength(entry.valid!);
    expect(batch.rows.filter(row => row.state === 'invalid').every(row => row.warnings.length > 0)).toBe(true);
  }
  expect(await db.owned('transactions', owner)).toHaveLength(0);
  const committed = ['ofx-sgml-1252.ofx', 'csv-banco-1252.csv', 'tsv-utf16le.txt', 'xls-biff8.xls', 'xlsx-multi-sheet.xlsx'];
  for (const name of committed) await confirmValid(batches[direct.findIndex(entry => entry.file === name)]!);
  const rows = await db.owned('transactions', owner), expected = direct.filter(entry => committed.includes(entry.file));
  expect(rows).toHaveLength(expected.reduce((sum, entry) => sum + entry.valid!, 0));
  expect(centsToMoney(rows.reduce((sum, row) => sum + moneyToCents(row.amount), 0n))).toBe(centsToMoney(expected.reduce((sum, entry) => sum + moneyToCents(entry.total!), 0n)));
  expect(new Set(rows.map(row => row.source))).toEqual(new Set(['ofx', 'csv', 'spreadsheet']));
});
it('persists actionable diagnostics for hostile, protected and corrupt files without rows or transactions', async () => {
  const failures = corpus.filter(entry => entry.error);
  expect(failures).toHaveLength(10);
  for (const [index, batch] of (await upload(failures.map(entry => entry.file))).entries()) {
    expect([failures[index]!.file, batch.state, batch.rows.length, batch.layout]).toEqual([failures[index]!.file, 'failed', 0, null]);
    expect(batch.error!.length).toBeGreaterThan(20);
  }
  expect(await db.owned('transactions', owner)).toHaveLength(0);
});
it('requires assisted mapping for unknown layouts and ambiguous values, then reuses only remembered profiles', async () => {
  const [unknown, dates, amounts] = await upload(['csv-unknown-layout.txt', 'csv-ambiguous-dates.csv', 'csv-ambiguous-amounts.csv']);
  for (const batch of [unknown!, dates!, amounts!]) { expect(batch.state).toBe('failed'); expect(batch.layout!.reasons.length).toBe(1); }
  expect(unknown!.layout!.suggestion).toMatchObject({ headerRow: 0, date: 0, description: 1, amount: 2 });
  const mapped = await mapImport(db, owner, randomUUID(), unknown!.id, unknown!.revision, { mapping: mapping({ headerRow: 0 }), remember: true });
  expect(mapped).toMatchObject({ id: unknown!.id, state: 'review', mapping: { headerRow: 0 } }); expect(mapped.rows.map(row => row.amount)).toEqual(['-23.45', '-8.00', '150.00']);
  const day = await mapImport(db, owner, randomUUID(), dates!.id, dates!.revision, { mapping: mapping({ dateOrder: 'dmy' }), remember: false });
  expect(day.rows.map(row => row.purchaseDate)).toEqual(['2026-02-01', '2026-04-03', '2026-06-05']);
  const decimal = await mapImport(db, owner, randomUUID(), amounts!.id, amounts!.revision, { mapping: mapping({ decimal: ',' }), remember: true });
  expect(decimal.rows.map(row => row.amount)).toEqual(['-1234.00', '-2500.00', '10.00']);
  const preferences = (await db.owned('preferences', owner))[0]!.settings.importProfiles as Record<string, unknown>;
  expect(Object.keys(preferences)).toEqual(expect.arrayContaining([unknown!.layout!.sheets[0]!.fingerprint, amounts!.layout!.sheets[0]!.fingerprint]));
  // Same header and separator means the same layout: the remembered decimal applies, the date order is still asked.
  expect(dates!.layout!.sheets[0]!.fingerprint).toBe(amounts!.layout!.sheets[0]!.fingerprint);
  expect(Object.keys(preferences)).toHaveLength(2);
  const [again, datesAgain] = await upload(['csv-unknown-layout.txt', 'csv-ambiguous-dates.csv']);
  expect(again).toMatchObject({ state: 'review', mapping: null }); expect(again!.rows[0]!.warnings.join(' ')).toContain('Mapeamento salvo');
  expect(datesAgain!.state).toBe('failed');
  expect(await db.owned('transactions', owner)).toHaveLength(0);
});
it('chooses spreadsheet tabs explicitly, replaces reviewed batches auditably and validates the mapping boundary', async () => {
  const [workbook, statement] = await upload(['xlsx-two-statements.xlsx', 'ofx-xml-card.ofx']);
  expect(workbook!.layout!.sheets.map(sheet => sheet.name)).toEqual(['Conta', 'Cartão']);
  await expect(mapImport(db, owner, randomUUID(), workbook!.id, 'stale', { mapping: mapping({ sheet: 'Conta' }), remember: false })).rejects.toMatchObject({ status: 409 });
  await expect(mapImport(db, owner, randomUUID(), workbook!.id, workbook!.revision, { mapping: mapping({ sheet: 'Inexistente' }), remember: false })).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
  await expect(mapImport(db, owner, randomUUID(), workbook!.id, workbook!.revision, { mapping: mapping({ sheet: 'Conta', amount: 7 }), remember: false })).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
  await expect(mapImport(db, owner, randomUUID(), statement!.id, statement!.revision, { mapping: mapping({}), remember: false })).rejects.toMatchObject({ code: 'BATCH_STATE' });
  const conta = await mapImport(db, owner, randomUUID(), workbook!.id, workbook!.revision, { mapping: mapping({ sheet: 'Conta' }), remember: false });
  expect(conta).toMatchObject({ id: workbook!.id, state: 'review', format: 'XLSX · aba Conta', rows: [{ provenance: { cell: 'Conta!C2' } }] });
  const key = randomUUID(), cartao = await mapImport(db, owner, key, conta.id, conta.revision, { mapping: mapping({ sheet: 'Cartão' }), remember: true });
  expect(cartao.id).not.toBe(conta.id);
  expect(cartao.rows.map(row => row.provenance.cell)).toEqual(["'Cartão'!C2", "'Cartão'!C3"]);
  expect(await loadImport(db, owner, conta.id)).toMatchObject({ state: 'cancelled', rows: [{ provenance: { cell: 'Conta!C2' } }] });
  // Replaying the same request returns the replacement without creating another batch.
  expect((await mapImport(db, owner, key, conta.id, conta.revision, { mapping: mapping({ sheet: 'Cartão' }), remember: true })).id).toBe(cartao.id);
  expect(await db.owned('importBatches', owner)).toHaveLength(3);
  const [remembered] = await upload(['xlsx-two-statements.xlsx']);
  expect(remembered).toMatchObject({ state: 'review', format: 'XLSX · aba Cartão' });
});
