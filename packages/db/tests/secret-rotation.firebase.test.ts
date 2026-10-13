import { afterAll, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testStore, clearTestCollections } from './firestore-fixture';
import { migrateToFirebase } from '../src/firebase-migration';
import { createAuth } from '../../../apps/next/src/lib/auth';
import { provisionUser } from '../../../apps/next/src/lib/provision-user';

const db=testStore('secret-rotation-'+randomBytes(6).toString('hex'));
const origin='http://127.0.0.1:3000', owner='10000000-0000-4000-8000-000000000001';
const password='synthetic-secret-lifecycle-password', replacement='synthetic-secret-lifecycle-replacement';
afterAll(async()=>{await clearTestCollections(db);await db.firestore.terminate();});

it('rotates signing keys with retained session records, then revokes credentials without changing finances',async()=> {
  await migrateToFirebase(db,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));
  await provisionUser(db,{email:'rotation@example.test',password,ownerId:owner});
  const before=await db.query('transactions',{order:[{field:'id',direction:'asc'}]});
  const previousKey='synthetic-previous-signing-key'.repeat(3), nextKey='synthetic-next-signing-key'.repeat(3);
  for(const invalid of ['', 'short']) {
    let message='';
    try {createAuth(db,origin,invalid);}catch(error){message=(error as Error).message;}
    expect(message).toBe('AUTH_SECRET requires at least 32 characters.');
  }
  const previous=createAuth(db,origin,previousKey), rotated=createAuth(db,origin,nextKey);
  const login=(auth:typeof previous,pass=password)=>auth.handler(new Request(origin+'/api/auth/sign-in/email',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'rotation@example.test',password:pass}),
  }));
  const first=await login(previous);expect(first.status).toBe(200);
  const token=first.headers.get('set-auth-token')!,cookie=first.headers.get('set-cookie')!.split(';')[0]!;
  const session=(auth:typeof previous,headers:Record<string,string>)=>auth.api.getSession({headers:new Headers(headers),query:{disableCookieCache:true}});
  expect((await session(previous,{authorization:'Bearer '+token}))?.user.id).toBe(owner);
  expect((await session(previous,{cookie}))?.user.id).toBe(owner);
  const retained=await db.query('authSessions');expect(retained).toHaveLength(1);
  // Retain the database record to isolate signature rotation from revocation.
  expect(await session(rotated,{authorization:'Bearer '+token})).toBeNull();
  expect(await session(rotated,{cookie})).toBeNull();
  expect(await db.query('authSessions')).toEqual(retained);
  const fresh=await login(rotated);expect(fresh.status).toBe(200);
  const freshToken=fresh.headers.get('set-auth-token')!;
  expect((await session(rotated,{authorization:'Bearer '+freshToken}))?.user.id).toBe(owner);
  expect(await session(previous,{authorization:'Bearer '+freshToken})).toBeNull();
  await provisionUser(db,{email:'rotation@example.test',password:replacement,reset:true});
  expect(await db.query('authSessions')).toHaveLength(0);
  expect(await session(rotated,{authorization:'Bearer '+freshToken})).toBeNull();
  expect((await login(rotated)).status).toBe(401);
  expect((await login(rotated,replacement)).status).toBe(200);
  expect(await db.query('transactions',{order:[{field:'id',direction:'asc'}]})).toEqual(before);
  // Startup errors and ordinary public auth responses never echo the signing key.
  expect(await fresh.text()).not.toContain(nextKey);
});
