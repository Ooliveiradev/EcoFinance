import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testStore, clearTestCollections } from './firestore-fixture';
import type { Database, Models } from '../src';
import { migrateToFirebase } from '../src/firebase-migration';
import { exportBackup, previewRestore, restoreBackup, ownedData, type UserBackup } from '../../../apps/next/src/lib/data-backup';
import { exportEntries } from '../../../apps/next/src/lib/data-control';
import { listEntries } from '../../../apps/next/src/lib/manual-finance-service';

// #15 retired Pluggy, notification/GPS capture and the Uber webhook. Entries they
// wrote stay readable, exportable and restorable with their origin and metadata.
const db = testStore('legacy-' + randomBytes(6).toString('hex')), fresh = testStore('legacy-empty-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001', adopter = randomUUID(), account = '00000000-0000-4000-8000-000000000001';
const trip = randomUUID(), legacy: Record<string, string> = { pluggy: randomUUID(), notification: randomUUID(), uber: randomUUID() };
type Row = Record<string, unknown>;
const pick = (row: Row) => ({ source: row.source, description: row.description, amount: row.amount, latitude: row.latitude, longitude: row.longitude, purchaseDate: row.purchaseDate });

beforeAll(async () => {
  for (const store of [db, fresh]) await clearTestCollections(store);
  await migrateToFirebase(db, JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json', 'utf8')));
  const now = new Date();
  await fresh.put('users', { id: adopter, displayName: 'Nova instalação', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  const bank = (await db.get('accounts', account))!;
  await db.put('accounts', { ...bank, pluggyItemId: 'item-sintetico', pluggyAccountId: 'conta-sintetica' });
  await db.put('uberTripsMetadata', { id: trip, ownerId: owner, originAddress: 'Origem sintética', destinationAddress: 'Destino sintético', driverName: null, durationSeconds: 900, createdAt: now });
  const template = (await db.get('transactions', '00000000-0000-4000-8000-000000000003'))!;
  const rows: Partial<Models['transactions']>[] = [
    { id: legacy.pluggy, source: 'pluggy', description: 'Sincronizado pelo banco', amount: '-11.00', externalId: 'pluggy-sintetico', latitude: null, longitude: null },
    { id: legacy.notification, source: 'notification', description: 'Capturado por notificação', amount: '-22.00', externalId: null, latitude: -23.5614, longitude: -46.6559 },
    { id: legacy.uber, source: 'uber', description: 'Viagem sintética', amount: '-33.00', externalId: null, latitude: null, longitude: null, uberMetadataId: trip },
  ];
  for (const row of rows) await db.put('transactions', { ...template, kind: 'expense', status: 'recorded', refundOfId: null, uberMetadataId: null, ...row } as Models['transactions']);
});
afterAll(async () => { for (const store of [db, fresh]) { await clearTestCollections(store); await store.firestore.terminate(); } });

async function legacyRows(store: Database, id: string) {
  const rows = await store.transaction(tx => ownedData(tx, id));
  return { rows, entries: rows.transactions.filter(r => ['pluggy', 'notification', 'uber'].includes(String(r.source))).sort((a, b) => String(a.source).localeCompare(String(b.source))) };
}

it('keeps legacy entries in the regular listing, the entry CSV and the full backup', async () => {
  const listed = await listEntries(db, owner, { limit: '100' }) as { entries: Row[] };
  expect(listed.entries.filter(e => Object.values(legacy).includes(String(e.id))).map(e => e.source).sort()).toEqual(['notification', 'pluggy', 'uber']);
  const csv = await exportEntries(db, owner, {});
  for (const [source, id] of Object.entries(legacy)) expect(csv.split('\r\n').find(line => line.includes(id))).toContain(`;${source};`);
  const backup = await exportBackup(db, owner), { entries } = await legacyRows(db, owner);
  const exported = (backup.collections.transactions as Row[]).filter(r => Object.values(legacy).includes(String(r.id)));
  expect(exported.map(pick).sort((a, b) => String(a.source).localeCompare(String(b.source)))).toEqual(entries.map(pick));
  expect(exported.find(r => r.id === legacy.uber)!.uberMetadataId).toBe(trip);
  expect(backup.collections.uberTripsMetadata).toEqual([expect.objectContaining({ id: trip, originAddress: 'Origem sintética', durationSeconds: 900 })]);
  expect(backup.collections.accounts).toContainEqual(expect.objectContaining({ id: account, pluggyItemId: 'item-sintetico', pluggyAccountId: 'conta-sintetica' }));
});

it('restores legacy origins, coordinates, trip links and provider ids into a new installation', async () => {
  const backup = JSON.parse(JSON.stringify(await exportBackup(db, owner))) as UserBackup;
  const preview = await previewRestore(fresh, adopter, { backup });
  await restoreBackup(fresh, adopter, randomUUID(), { backup, ownerMode: 'adopt', confirm: 'RESTAURAR' }, preview.currentRevision);
  const source = await legacyRows(db, owner), restored = await legacyRows(fresh, adopter);
  expect(restored.entries.map(pick)).toEqual(source.entries.map(pick));
  const ride = restored.entries.find(r => r.source === 'uber')!, metadata = restored.rows.uberTripsMetadata;
  expect(metadata).toHaveLength(1);
  expect(ride.uberMetadataId).toBe(metadata[0]!.id);
  expect(metadata[0]).toMatchObject({ ownerId: adopter, originAddress: 'Origem sintética', destinationAddress: 'Destino sintético', durationSeconds: 900 });
  expect(restored.rows.accounts.find(a => a.pluggyItemId)).toMatchObject({ pluggyItemId: 'item-sintetico', pluggyAccountId: 'conta-sintetica', ownerId: adopter });
});
