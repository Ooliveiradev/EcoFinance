import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { migrateToFirebase, backupFirebase, restoreFirebase, emptySourceSnapshot, portableDocument } from '../src/firebase-migration';
import { testStore, clearTestCollections } from './firestore-fixture';
const suffix=randomBytes(6).toString('hex');
const source=testStore('migration-'+suffix), restored=testStore('restore-'+suffix), empty=testStore('empty-'+suffix);
let snapshot:unknown;
beforeAll(async()=> {snapshot=JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8'));await migrateToFirebase(source,snapshot);});
afterAll(async()=> {for(const store of [source,restored,empty]) {await clearTestCollections(store);await store.firestore.terminate();}});
it('migrates all financial relations and replays without duplicate documents',async()=> {
  const before=await backupFirebase(source);
  await migrateToFirebase(source,snapshot);
  expect(await backupFirebase(source)).toEqual(before);
  expect(await source.query('transactions')).toHaveLength(2);
  const accounts=await source.query('accounts');
  expect(accounts.map(a=>a.balance).sort()).toEqual(['0.00','1000.00']);
  expect((await source.query('recurrenceOccurrences'))[0]!.dueDate).toBe('2026-09-30');
});
it('restores the complete database, exact values and microsecond timestamps',async()=> {
  const backup=await backupFirebase(source);
  await restoreFirebase(restored,backup);
  await restoreFirebase(restored,backup);
  expect(await backupFirebase(restored)).toEqual(backup);
  const raw=await restored.firestore.collection('accounts').doc('00000000-0000-4000-8000-000000000001').get();
  expect(raw.get('createdAt').nanoseconds).toBe(442798000);
});
it('initializes a genuinely empty source and rejects a changed target',async()=> {
  await migrateToFirebase(empty,emptySourceSnapshot());
  expect(await empty.query('accounts')).toEqual([]);
  const row=(await source.query('accounts'))[0]!;
  await empty.put('users',(await source.get('users',row.ownerId))!,true);
  await expect(migrateToFirebase(empty,emptySourceSnapshot())).rejects.toThrow('not empty');
});
it('rejects tampered backup and never partially writes to a populated target',async()=> {
  const backup=await backupFirebase(source);
  const changed=structuredClone(backup);changed.sha256='invalid';
  await expect(restoreFirebase(restored,changed)).rejects.toThrow('Invalid');
  await expect(restoreFirebase(empty,backup)).rejects.toThrow('not empty');
  expect(await backupFirebase(restored)).toEqual(backup);
});
it('enforces owner references, immutable ownership and exact financial types',async()=> {
  const original=(await source.query('transactions'))[0]!;
  await expect(source.put('transactions',{...original,id:randomUUID(),ownerId:'20000000-0000-4000-8000-000000000001'})).rejects.toThrow('cross-owner');
  await expect(source.put('transactions',{...original,ownerId:'20000000-0000-4000-8000-000000000001'})).rejects.toThrow('immutable');
  await expect(source.put('transactions',{...original,amount:42.9 as never})).rejects.toThrow('invariant');
  await expect(source.put('transactions',{...original,purchaseDate:'2026-02-30'})).rejects.toThrow('invariant');
  await expect(source.remove('accounts',original.accountId)).rejects.toThrow('restricted');
});
it('checks unique business keys atomically under concurrent writes',async()=> {
  const budget=(await source.query('budgets'))[0]!;
  const rows=await Promise.allSettled(Array.from({length:4},()=>source.put('budgets',{...budget,id:randomUUID(),competenceMonth:'2026-10-01'},true)));
  expect(rows.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(rows.filter(r=>r.status==='rejected')).toHaveLength(3);
});
it('refuses JSON numbers and counters that would silently lose source precision',()=> {
  expect(()=>portableDocument('preferences',{id:'synthetic',settings:'{"large":9007199254740993}'})).toThrow('exactly');
  expect(()=>portableDocument('preferences',{id:'synthetic',settings:'{"decimal":1.234567890123456789}'})).toThrow('exactly');
  expect(()=>portableDocument('auth_rate_limits',{id:'synthetic',last_request:'9007199254740993'})).toThrow('precision');
  expect(portableDocument('preferences',{id:'synthetic',settings:'{"amount":1.230,"count":1e3}'}).settings).toEqual({amount:1.23,count:1000});
});
