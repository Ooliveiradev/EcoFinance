import { it, expect } from 'vitest';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { testStore,clearTestCollections } from './firestore-fixture';
import { migrateToFirebase,exportPortableFirebase } from '../src/firebase-migration';
import { migrate,readMigrations } from '../src/migrations';
import { restorePortable } from '../src/portable-restore';
import { exportSnapshot } from '../src/portable-snapshot';
import { provisionUser } from '../../../apps/next/src/lib/provision-user';
import { createHash } from 'node:crypto';
it('rolls current Firebase writes back to PostgreSQL without losing money or ownership',async()=> {
  const url=process.env.TEST_DATABASE_URL;
  if(!url)throw new Error('Disposable TEST_DATABASE_URL and Firestore emulator required.');
  const name='ecofinance_rollback_'+randomBytes(6).toString('hex');
  const admin=postgres(url,{max:1,prepare:false,onnotice:()=>{}});
  const store=testStore('rollback-'+randomBytes(6).toString('hex'));
  let target:ReturnType<typeof postgres>|undefined;
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    const targetUrl=new URL(url);targetUrl.pathname='/'+name;
    target=postgres(targetUrl.toString(),{max:1,prepare:false,onnotice:()=>{}});
    await migrate(target,await readMigrations('packages/db/migrations'));
    await migrateToFirebase(store,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));
    const owner='10000000-0000-4000-8000-000000000001';
    await provisionUser(store,{email:'rollback@example.test',password:'synthetic-rollback-password',ownerId:owner});
    await store.loginAttempt(createHash('sha256').update('synthetic').digest('hex'));
    const account=(await store.owned('accounts',owner))[0]!;
    await store.put('accounts',{...account,balance:'9999999999999.99'});
    const portable=await exportPortableFirebase(store);
    await restorePortable(target,portable);
    const roundtrip=await exportSnapshot(target);
    for(const [name,table]of Object.entries(portable.tables)) {
      expect(roundtrip.tables[name]!.count).toBe(table.count);
      expect(roundtrip.tables[name]!.sumsInCents).toEqual(table.sumsInCents);
      for(const row of table.rows) {
        const actual=roundtrip.tables[name]!.rows.find(r=>r.id===row.id)!;
        for(const [key,value]of Object.entries(row)) {
          const isJson=['settings','provenance','warnings','before_snapshot','after_snapshot'].includes(key);
          expect(isJson && value!==null?JSON.parse(String(actual[key])):actual[key]).toEqual(isJson && value!==null?JSON.parse(String(value)):value);
        }
      }
    }
    expect(roundtrip.tables.users!.rows.find(r=>r.id===owner)!.email).toBe('rollback@example.test');
    await expect(restorePortable(target,portable)).rejects.toThrow('empty');
  } finally {
    await clearTestCollections(store);await store.firestore.terminate();
    await target?.end();await admin`DROP DATABASE IF EXISTS ${admin(name)}`;await admin.end();
  }
},60000);
