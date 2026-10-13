import { afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { backupFirebase, restoreFirebase } from '../src/firebase-migration';
import { saveAccount, saveCategory, saveEntry, listEntries } from '../../../apps/next/src/lib/manual-finance-service';
import { receiveImports, processImport, reviewImportItem, loadImport } from '../../../apps/next/src/lib/import-store';
import { confirmImport } from '../../../apps/next/src/lib/import-commit';
import { createAuth } from '../../../apps/next/src/lib/auth';
import { provisionUser } from '../../../apps/next/src/lib/provision-user';
import { monthTotals } from '../../shared/src';
import { hash } from '../../../apps/next/src/lib/finance-operation';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

// The testStore guard refuses any non-demo/non-loopback target.
const suffix=randomBytes(6).toString('hex'), sourceId='incident-source-'+suffix, restoredId='incident-restored-'+suffix;
const source=testStore(sourceId), restored=testStore(restoredId);
const origin='http://127.0.0.1:3000', secret='synthetic-incident-secret'.repeat(3);
const owners=['10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'];
const password='synthetic-incident-password', replacement='synthetic-incident-replacement';
const run=promisify(execFile), containers=new Set<string>(), image=process.env.RECOVERY_IMAGE;
interface Release {
  login(pass?:string,web?:boolean):Promise<Response>;
  session(headers:Record<string,string>):Promise<{user:{id:string}}|null>;
  stop():Promise<void>;
  url?:string;
}
async function stop(name:string) { await run('docker',['rm','--force',name]);containers.delete(name); }
afterAll(async()=> {
  for(const name of containers) await stop(name);
  for(const db of [source,restored]) {await clearTestCollections(db);await db.firestore.terminate();}
});
async function release(db:typeof source,databaseId:string,key:string,port=8086):Promise<Release> {
  if(!image) {
    const auth=createAuth(db,origin,key);
    return {
      login: (pass=password,web=false)=>auth.handler(new Request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',...(web?{origin}:{})},body:JSON.stringify({email:'incident@example.test',password:pass})})),
      session: headers=>auth.api.getSession({headers:new Headers(headers),query:{disableCookieCache:true}}),
      stop: async()=>{},
    };
  }
  if(!/^[a-z0-9][a-z0-9./:_-]+$/i.test(image) || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')) throw new Error('Invalid recovery fixture target.');
  const name='ef-recovery-'+randomBytes(6).toString('hex'), url='http://127.0.0.1:'+port;
  await run('docker',['run','--detach','--rm','--name',name,'--network','host',
    '--env','HOSTNAME=127.0.0.1','--env','PORT='+port,'--env','AUTH_URL='+url,'--env','AUTH_SECRET='+key,
    '--env','FIREBASE_PROJECT_ID=demo-ecofinance','--env','FIRESTORE_DATABASE_ID='+databaseId,
    '--env','FIRESTORE_EMULATOR_HOST='+process.env.FIRESTORE_EMULATOR_HOST,image]);
  containers.add(name);
  let healthy=false;
  for(let i=0;i<120;i++) {
    healthy=await fetch(url+'/api/health').then(r=>r.ok).catch(()=>false);
    if(healthy)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!healthy)throw new Error('Recovery fixture container failed to start.');
  return {
    url,
    // Undici adds Sec-Fetch-Mode automatically; a native client sends no fetch
    // metadata. An explicit empty value reproduces that native request without
    // weakening the application's browser origin checks.
    login: (pass=password,web=false)=>fetch(url+'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',...(web?{origin:url}:{'sec-fetch-mode':''})},body:JSON.stringify({email:'incident@example.test',password:pass})}),
    session: async headers=>{
      const response=await fetch(url+'/api/auth/get-session',{headers});
      if(!response.ok)throw new Error('Recovery session check failed.');
      return response.json();
    },
    stop: ()=>stop(name),
  };
}
it('recovers from failed configuration/corruption, revokes restored credentials and replays imports once',async()=> {
  await clearTestCollections(source); await clearTestCollections(restored);
  const now=new Date();
  for(const id of owners) await source.put('users',{id,displayName:'Synthetic incident fixture',email:null,emailVerified:false,image:null,createdAt:now,updatedAt:now});
  const owner=owners[0]!, other=owners[1]!;
  const account=String((await saveAccount(source,owner,randomUUID(),{name:'Synthetic recovery',type:'banco',openingBalance:'0.00',openingDate:'2026-10-01'})).id);
  const category=String((await saveCategory(source,owner,randomUUID(),{name:'Synthetic recovery',color:'#336699'})).id);
  await provisionUser(source,{email:'incident@example.test',password,ownerId:owner});
  const knownRelease=await release(source,sourceId,secret);
  const initial=await knownRelease.login(); expect(initial.status).toBe(200);
  const oldToken=initial.headers.get('set-auth-token')!; expect(oldToken).toBeTruthy();
  const browser=await knownRelease.login(password,true);expect(browser.status).toBe(200);
  const oldCookie=browser.headers.get('set-cookie')!.split(';')[0]!;expect(oldCookie).toBeTruthy();
  const manual=await saveEntry(source,owner,randomUUID(),{accountId:account,categoryId:category,description:'Synthetic manual',amount:'0.10',kind:'expense',status:'settled',purchaseDate:'2026-10-01',competenceMonth:'2026-10-01',paidDate:'2026-10-01',dueDate:null,notes:null});
  const received=await receiveImports(source,owner,randomUUID(),[{name:'synthetic-incident.csv',mime:'text/csv',bytes:new TextEncoder().encode('data;descricao;valor\n2026-10-02;Synthetic import;-0.20\n')}],{accountId:account,cardId:null});
  const batch=(received.batches as {id:string;revision:string}[])[0]!;
  const analysis=await processImport(source,owner,batch.id,batch.revision), row=analysis.rows[0]!;
  await reviewImportItem(source,owner,randomUUID(),batch.id,row.id,row.revision,{description:row.description,amount:row.amount,purchaseDate:row.purchaseDate,competenceMonth:row.competenceMonth,categoryId:category,selected:true,resolution:'new',duplicateId:null});
  const ready=await loadImport(source,owner,batch.id), receipt=randomUUID();
  const confirmed=await confirmImport(source,owner,receipt,batch.id,ready.revision,{confirmed:true});
  await source.put('authVerifications',{id:randomUUID(),identifier:'synthetic-recovery',value:'synthetic-reset-token',expiresAt:new Date(Date.now()+60000),createdAt:now,updatedAt:now});
  const backup=await backupFirebase(source), backedUpAt=Date.now();
  const before=await source.owned('transactions',owner,{order:[{field:'id',direction:'asc'}]});
  expect(monthTotals(before,'2026-10')).toEqual({income:0n,expenses:30n});
  const started=Date.now();
  // CI also runs the real standalone Next.js image over HTTP. A candidate with
  // invalid configuration must fail login even if its liveness route returns 200.
  if(image) {
    const candidate=await release(source,sourceId,'short',8087);
    expect((await candidate.login()).status).not.toBe(200); await candidate.stop();
  } else expect(()=>createAuth(source,origin,'short')).toThrow('AUTH_SECRET');
  expect((await knownRelease.login()).status).toBe(200);
  const corrupt=(await source.get('transactions',String(manual.id)))!;
  await source.put('transactions',{...corrupt,amount:'-999.00'});
  expect(monthTotals(await source.owned('transactions',owner),'2026-10').expenses).not.toBe(30n);
  await expect(restoreFirebase(restored,{...backup,sha256:'invalid'})).rejects.toThrow('Invalid Firebase backup');
  // A freshly recomputed checksum cannot bypass document/reference invariants.
  for(const field of ['amount','ownerId']) {
    const forged=structuredClone(backup), record=forged.records.find(item=>item.path==='transactions/'+manual.id)!;
    if(record.data && typeof record.data==='object' && record.data.type==='map')record.data.values[field]=field==='amount'?'invalid-money':other;
    forged.sha256=hash(forged.records);
    await expect(restoreFirebase(restored,forged)).rejects.toThrow();
    expect(await restored.query('users')).toHaveLength(0);
  }
  expect(await restored.query('users')).toHaveLength(0);
  await expect(restoreFirebase(source,backup)).rejects.toThrow('not empty');
  await restoreFirebase(restored,backup); await restoreFirebase(restored,backup);
  expect(await restored.owned('transactions',owner,{order:[{field:'id',direction:'asc'}]})).toEqual(before);
  expect(await restored.query('authSessions')).toHaveLength(0);
  expect(await restored.query('authVerifications')).toHaveLength(0);
  const recovered=await release(restored,restoredId,secret,8088);
  expect(await recovered.session({authorization:'Bearer '+oldToken})).toBeNull();
  expect(await recovered.session({cookie:oldCookie})).toBeNull();
  const markers=await restored.firestore.collection('_unique').get();
  expect(markers.docs.every(doc=>!/^(authSessions|authVerifications)\//.test(String(doc.get('path'))))).toBe(true);
  await recovered.stop();
  // Reset compromised credentials while keeping financial owner and operation receipts.
  await provisionUser(restored,{email:'incident@example.test',password:replacement,reset:true});
  await knownRelease.stop();
  const rotated=await release(restored,restoredId,'synthetic-rotated-secret'.repeat(3));
  expect((await rotated.login()).status).not.toBe(200);
  const fresh=await rotated.login(replacement); expect(fresh.status).toBe(200);
  const token=fresh.headers.get('set-auth-token')!;
  const session=await rotated.session({authorization:'Bearer '+token});
  expect(session?.user.id).toBe(owner);
  const replay=await Promise.all(Array.from({length:2},async()=> {
    if(!rotated.url)return confirmImport(restored,session!.user.id,receipt,batch.id,ready.revision,{confirmed:true});
    const response=await fetch(rotated.url+'/api/imports/'+batch.id+'/confirm',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+token,'Idempotency-Key':receipt,'If-Match':ready.revision},body:JSON.stringify({confirmed:true})});
    expect(response.status).toBe(200); return response.json();
  }));
  expect(replay).toEqual([confirmed,confirmed]);
  expect(await restored.owned('transactions',owner)).toHaveLength(before.length);
  expect(monthTotals(await restored.owned('transactions',owner),'2026-10')).toEqual({income:0n,expenses:30n});
  expect((await listEntries(restored,other,{})).entries).toHaveLength(0);
  if(rotated.url) {
    const response=await fetch(rotated.url+'/api/entries?competenceMonth=2026-10-01',{headers:{authorization:'Bearer '+token}});
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result.entries.map((entry:{amount:string})=>entry.amount).sort()).toEqual(['-0.10','-0.20']);
  }
  const elapsedMs=Date.now()-started, rpoMs=started-backedUpAt;
  expect(elapsedMs).toBeLessThan(60*60*1000); expect(rpoMs).toBeLessThan(24*60*60*1000);
  const evidence={scenario:'synthetic-configuration-corruption-credential-recovery',mode:image?'production-container-http':'application-factory',revision:process.env.GITHUB_SHA??null,elapsedMs,rpoMs,duplicateOperations:0};
  await mkdir('.ci-diagnostics',{recursive:true});
  await writeFile('.ci-diagnostics/recovery-evidence.json',JSON.stringify(evidence)+'\n');
  console.info(JSON.stringify(evidence));
},240000);
