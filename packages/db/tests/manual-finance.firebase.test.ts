import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { testStore,clearTestCollections } from './firestore-fixture';
import { migrateToFirebase,backupFirebase,restoreFirebase,exportPortableFirebase } from '../src/firebase-migration';
import { saveAccount,saveCategory,saveEntry,archiveEntry,archiveReference,listEntries,revision } from '../../../apps/next/src/lib/manual-finance-service';
import { accountBalances,monthTotals } from '../../shared/src';
const db=testStore('manual-'+randomBytes(6).toString('hex')),copy=testStore('manual-copy-'+randomBytes(6).toString('hex'));
const owner='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000001';
let account:string,destination:string,category:string,foreign:string;
const accountInput={name:'Manual',type:'carteira',openingBalance:'100.00',openingDate:'2026-10-01',color:'#123456',sortOrder:2};
function expense(patch:Record<string,unknown>={}) {return {accountId:account,categoryId:category,description:'Teste de centavos',amount:'0.10',kind:'expense',status:'settled',purchaseDate:'2026-10-01',competenceMonth:'2026-10-01',dueDate:null,paidDate:'2026-10-02',notes:'Anotação privada',...patch};}
beforeAll(async()=> {
  await migrateToFirebase(db,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));
  account=String((await saveAccount(db,owner,randomUUID(),accountInput)).id);
  destination=String((await saveAccount(db,owner,randomUUID(),{...accountInput,name:'Destino',openingBalance:'0'})).id);
  foreign=String((await saveAccount(db,other,randomUUID(),{...accountInput,name:'Outra pessoa'})).id);
  category=String((await saveCategory(db,owner,randomUUID(),{name:'Personalizada',color:'#112233'})).id);
});
afterAll(async()=> {for(const store of [db,copy]) {await clearTestCollections(store);await store.firestore.terminate();}});
it('retries concurrent creation once, refuses changed payload, and isolates request IDs by owner',async()=> {
  const request=randomUUID();
  const results=await Promise.all(Array.from({length:3},()=>saveEntry(db,owner,request,expense())));
  expect(new Set(results.map(r=>r.id)).size).toBe(1);
  expect(await db.owned('transactions',owner,{where:[{field:'externalId',value:'manual:'+request}]})).toHaveLength(1);
  await expect(saveEntry(db,owner,request,expense({amount:'0.20'}))).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
  expect((await saveAccount(db,other,request,{...accountInput,name:'Mesmo ID em outro dono'})).id).toBeTypeOf('string');
});
it('edits money and notes with optimistic concurrency, deletes reversibly, and updates exact balances',async()=> {
  const saved=await saveEntry(db,owner,randomUUID(),expense({description:'Fluxo CRUD'}));
  const id=String(saved.id);
  const edited=await saveEntry(db,owner,randomUUID(),expense({amount:'0.20',notes:'Corrigido',description:'Fluxo CRUD'}),id,String(saved.revision));
  await expect(saveEntry(db,owner,randomUUID(),expense(),id,String(saved.revision))).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  expect((await db.get('transactions',id))!.notes).toBe('Corrigido');
  const removed=await archiveEntry(db,owner,randomUUID(),id,String(edited.revision),true);
  expect((await listEntries(db,owner,{description:'Fluxo CRUD'})).entries).toHaveLength(0);
  expect((await listEntries(db,owner,{description:'Fluxo CRUD',archived:'true'})).entries).toHaveLength(1);
  await expect(saveEntry(db,owner,randomUUID(),expense(),id,String(removed.revision))).rejects.toMatchObject({code:'ARCHIVED_ENTRY'});
  await archiveEntry(db,owner,randomUUID(),id,String(removed.revision),false);
  const rows=await db.owned('transactions',owner,{where:[{field:'accountId',value:account}]});
  expect(accountBalances([(await db.get('accounts',account))!],rows,'2026-10-10').get(account)).toBe(9970n);
  expect(monthTotals(rows,'2026-10').expenses).toBe(30n);
});
it('writes, edits and deletes both transfer sides atomically without treating them as income or expense',async()=> {
  const created=await saveEntry(db,owner,randomUUID(),expense({kind:'transfer',toAccountId:destination,amount:'25.00',description:'Entre carteiras'}));
  const ids=created.ids as string[];
  let rows=await Promise.all(ids.map(id=>db.get('transactions',id)));
  expect(rows.map(r=>r!.amount).sort()).toEqual(['-25.00','25.00']);
  expect(rows[0]!.transferId).toBe(rows[1]!.transferId);
  expect(monthTotals(rows as never,'2026-10')).toEqual({income:0n,expenses:0n});
  const updated=await saveEntry(db,owner,randomUUID(),expense({kind:'transfer',toAccountId:destination,amount:'30.00'}),ids[1],String(created.revision));
  rows=await Promise.all(ids.map(id=>db.get('transactions',id)));
  expect(rows.map(r=>r!.amount).sort()).toEqual(['-30.00','30.00']);
  const archived=await archiveEntry(db,owner,randomUUID(),ids[0]!,String(updated.revision),true);
  expect((await Promise.all(ids.map(id=>db.get('transactions',id)))).every(r=>r!.archivedAt!==null)).toBe(true);
  await archiveEntry(db,owner,randomUUID(),ids[1]!,String(archived.revision),false);
  expect((await Promise.all(ids.map(id=>db.get('transactions',id)))).every(r=>r!.archivedAt===null)).toBe(true);
});
it('rejects foreign references and forged ownership without any partial financial writes',async()=> {
  const before=await db.query('transactions',{order:[{field:'id',direction:'asc'}]});
  await expect(saveEntry(db,owner,randomUUID(),expense({accountId:foreign}))).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(saveEntry(db,owner,randomUUID(),expense({kind:'transfer',toAccountId:foreign}))).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(saveEntry(db,owner,randomUUID(),expense({ownerId:other}))).rejects.toThrow();
  await expect(saveAccount(db,owner,randomUUID(),accountInput,foreign,'forged')).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(saveEntry(db,owner,'invalid',expense())).rejects.toMatchObject({code:'INVALID_REQUEST_ID'});
  expect(await db.query('transactions',{order:[{field:'id',direction:'asc'}]})).toEqual(before);
});
it('archives categories preserving historical reads and rejects new links to archived references',async()=> {
  const row=(await db.get('categories',category))!;
  const archived=await archiveReference(db,owner,randomUUID(),'categories',category,revision(row),true);
  const history=await listEntries(db,owner,{categoryId:category});
  expect(history.entries.length).toBeGreaterThan(0);
  await expect(saveEntry(db,owner,randomUUID(),expense())).rejects.toMatchObject({code:'ARCHIVED_REFERENCE'});
  await archiveReference(db,owner,randomUUID(),'categories',category,String(archived.revision),false);
});
it('paginates and filters in the database, and restores notes, receipts and transfer metadata natively',async()=> {
  const first=await listEntries(db,owner,{limit:1}),second=await listEntries(db,owner,{limit:1,page:2});
  expect(first.hasMore).toBe(true);expect(first.entries[0]!.id).not.toBe(second.entries[0]!.id);
  expect((await listEntries(db,other,{accountId:account})).entries).toEqual([]);
  const backup=await backupFirebase(db);await restoreFirebase(copy,backup);
  expect(await backupFirebase(copy)).toEqual(backup);
  await expect(exportPortableFirebase(db)).rejects.toThrow('schema v2');
});
it('edits dated opening balances with revisions and archives accounts without deleting history',async()=> {
  const before=(await db.get('accounts',account))!;
  const updated=await saveAccount(db,owner,randomUUID(),{...accountInput,name:'Carteira renomeada',color:'#abcdef',sortOrder:8,openingBalance:'120.00'},account,revision(before));
  await expect(saveAccount(db,owner,randomUUID(),accountInput,account,revision(before))).rejects.toMatchObject({code:'REVISION_CONFLICT'});
  const row=(await db.get('accounts',account))!;
  expect(row).toMatchObject({name:'Carteira renomeada',color:'#abcdef',sortOrder:8,openingBalance:'120.00',openingDate:'2026-10-01'});
  const rows=await db.owned('transactions',owner,{where:[{field:'accountId',value:account}]});
  expect(accountBalances([row],rows,'2026-10-10').get(account)).toBe(8970n);
  const archived=await archiveReference(db,owner,randomUUID(),'accounts',account,String(updated.revision),true);
  const history=await listEntries(db,owner,{accountId:account});expect(history.entries.length).toBeGreaterThan(0);
  expect(history.entries[0]!.accountName).toBe('Carteira renomeada');
  await expect(saveEntry(db,owner,randomUUID(),expense())).rejects.toMatchObject({code:'ARCHIVED_REFERENCE'});
  await archiveReference(db,owner,randomUUID(),'accounts',account,String(archived.revision),false);
  expect((await db.get('accounts',account))!.archivedAt).toBeNull();
});
