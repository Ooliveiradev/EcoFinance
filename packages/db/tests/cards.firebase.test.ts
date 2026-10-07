import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { collections } from '../src/firestore';
import { testStore,clearTestCollections } from './firestore-fixture';
import { migrateToFirebase,backupFirebase,restoreFirebase,exportPortableFirebase } from '../src/firebase-migration';
import { saveAccount,saveCategory,saveEntry,archiveEntry,revision } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard,archiveCard } from '../../../apps/next/src/lib/card-store';
import { addCardPurchase,saveInvoice,addInvoiceItem,payInvoice } from '../../../apps/next/src/lib/card-purchases';
import { reconcileCardEntry,reconcileCardOccurrence } from '../../../apps/next/src/lib/card-reconcile';
import { loadInvoice,cardCandidates } from '../../../apps/next/src/lib/card-read';
import { saveRule,generateMonth } from '../../../apps/next/src/lib/planning-rules';
import { loadPlanning } from '../../../apps/next/src/lib/planning-read';
import { closeMonth } from '../../../apps/next/src/lib/planning-budget';
import { accountBalances,monthTotals } from '../../shared/src';
const db=testStore('cards-'+randomBytes(6).toString('hex')),copy=testStore('cards-copy-'+randomBytes(6).toString('hex'));
const owner='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000001';
let account:string,category:string,foreign:string,card:string;
const purchase=(month:string,patch:Record<string,unknown>={})=>({description:'Compra '+month,categoryId:category,totalAmount:'300.00',count:3,purchaseDate:month+'-28',firstMonth:month,confirmed:true,...patch});
const payment=(amount:string,paidDate:string,patch:Record<string,unknown>={})=>({amount,paidDate,categoryId:category,transactionId:null,transactionRevision:null,confirmed:true,...patch});
const item=(month:string,patch:Record<string,unknown>={})=>({type:'interest',description:'Juros',amount:'10.00',categoryId:category,purchaseDate:month+'-28',competenceMonth:month,refundOfId:null,...patch});
async function view(month:string){return loadInvoice(db,owner,card,month);}
async function manual(month:string,patch:Record<string,unknown>={}) {
  const saved=await saveEntry(db,owner,randomUUID(),{accountId:account,categoryId:category,description:'Linha importada',amount:'100.00',kind:'expense',status:'recorded',purchaseDate:month+'-28',competenceMonth:month+'-01',dueDate:null,paidDate:null,...patch});
  return (await db.get('transactions',String(saved.id)))!;
}
beforeAll(async()=>{
  await migrateToFirebase(db,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));await clearTestCollections(db,[...collections.filter(c=>c!=='users'),'_unique','_migration']);
  const input={name:'Caixa',type:'carteira',openingBalance:'1000.00',openingDate:'2027-01-01'};
  account=String((await saveAccount(db,owner,randomUUID(),input)).id);foreign=String((await saveAccount(db,other,randomUUID(),input)).id);category=String((await saveCategory(db,owner,randomUUID(),{name:'Cartões',color:'#112233'})).id);
  card=String((await saveCard(db,owner,randomUUID(),{name:'Principal',paymentAccountId:account,closingDay:25,dueDay:5})).id);
});
afterAll(async()=>{for(const store of [db,copy]){await clearTestCollections(store);await store.firestore.terminate();}});
it('confirms 300 in 3x100 once under concurrent replays, crosses year and does not commit 600',async()=>{
  const key=randomUUID(),input=purchase('2027-12'),results=await Promise.all([1,2].map(()=>addCardPurchase(db,owner,key,card,input)));expect(results[0]).toEqual(results[1]);
  const entries=await db.owned('transactions',owner);expect(entries).toHaveLength(3);expect(await db.owned('installmentGroups',owner)).toHaveLength(1);expect(await db.owned('installments',owner)).toHaveLength(3);
  for(const month of ['2027-12','2028-01','2028-02'])expect(monthTotals(entries,month).expenses).toBe(10000n);
  const december=await view('2027-12');expect(december).toMatchObject({closingDate:'2027-12-25',dueDate:'2028-01-05',totals:{computed:'100.00',payments:'0.00',remaining:'100.00'}});expect(december.entries[0]).toMatchObject({installmentNumber:1,installmentCount:3,purchaseDate:'2027-12-28',paidDate:null});
  expect(accountBalances([(await db.get('accounts',account))!],entries,'2028-03-01').get(account)).toBe(100000n);
  await expect(addCardPurchase(db,owner,key,card,purchase('2027-12',{totalAmount:'600.00'}))).rejects.toMatchObject({code:'REQUEST_CONFLICT'});
});
it('reconciles stated total, prior debt, fees and credits; pays partially then fully without another expense',async()=>{
  let invoice=await view('2027-12');await saveInvoice(db,owner,randomUUID(),card,'2027-12',invoice.revision,{statedTotal:'115.00',previousBalance:'20.00',closed:true});
  invoice=await view('2027-12');await addInvoiceItem(db,owner,randomUUID(),invoice.id,invoice.revision,item('2027-12'));
  invoice=await view('2027-12');await addInvoiceItem(db,owner,randomUUID(),invoice.id,invoice.revision,item('2027-12',{type:'fee',description:'Tarifa',amount:'5.00'}));
  invoice=await view('2027-12');await addInvoiceItem(db,owner,randomUUID(),invoice.id,invoice.revision,item('2027-12',{type:'credit',description:'Abatimento',amount:'20.00'}));
  invoice=await view('2027-12');expect(invoice.totals).toMatchObject({purchases:'100.00',charges:'15.00',credits:'20.00',computed:'115.00',divergence:'0.00'});
  const key=randomUUID(),first=await payInvoice(db,owner,key,invoice.id,invoice.revision,payment('40.00','2028-01-05'));expect(await payInvoice(db,owner,key,invoice.id,invoice.revision,payment('40.00','2028-01-05'))).toEqual(first);
  invoice=await view('2027-12');expect(invoice).toMatchObject({status:'partial',totals:{payments:'40.00',remaining:'75.00',computed:'115.00'}});
  await expect(payInvoice(db,owner,randomUUID(),invoice.id,invoice.revision,payment('75.01','2028-01-05'))).rejects.toMatchObject({code:'PAYMENT_LIMIT'});
  await payInvoice(db,owner,randomUUID(),invoice.id,invoice.revision,payment('75.00','2028-01-06'));expect(await view('2027-12')).toMatchObject({status:'paid',totals:{remaining:'0.00',payments:'115.00'}});
  const entries=await db.owned('transactions',owner);expect(monthTotals(entries,'2027-12').expenses).toBe(9500n);expect(monthTotals(entries,'2028-01').expenses).toBe(10000n);expect(accountBalances([(await db.get('accounts',account))!],entries,'2028-01-06').get(account)).toBe(88500n);
});
it('retains invoice cycle/account snapshots when card settings change and preserves archived history',async()=>{
  const before=await view('2027-12'),original=(await db.get('cards',card))!,destination=String((await saveAccount(db,owner,randomUUID(),{name:'Outra conta',type:'banco',openingBalance:'0.00',openingDate:'2027-01-01'})).id);
  const changed=await saveCard(db,owner,randomUUID(),{name:'Principal novo',paymentAccountId:destination,closingDay:31,dueDay:31},card,revision(original));
  expect(await view('2027-12')).toEqual(before);expect(await view('2028-04')).toMatchObject({closingDate:'2028-04-30',dueDate:'2028-05-31',paymentAccountId:destination});
  const archived=await archiveCard(db,owner,randomUUID(),card,String(changed.revision),true);expect(await view('2027-12')).toEqual(before);await expect(addCardPurchase(db,owner,randomUUID(),card,purchase('2028-04'))).rejects.toMatchObject({code:'ARCHIVED_CARD'});
  const restored=await archiveCard(db,owner,randomUUID(),card,String(archived.revision),false);await saveCard(db,owner,randomUUID(),{name:'Principal',paymentAccountId:account,closingDay:25,dueDay:5},card,String(restored.revision));
});
it('removes an imported duplicate with a durable audit link and rejects restoration and duplicate reconciliation',async()=>{
  const invoice=await view('2028-01'),target=invoice.entries[0]!,source=await manual('2028-01');await db.put('transactions',{...source,source:'ofx',externalId:'synthetic-reimport'});
  const before=await view('2028-01'),input={sourceId:source.id,sourceRevision:revision(source),targetId:target.id,targetRevision:target.revision,confirmed:true},key=randomUUID();
  expect((await cardCandidates(db,owner,invoice.id)).entries.map(e=>e.id)).toContain(source.id);
  await reconcileCardEntry(db,owner,key,invoice.id,before.revision,input);await reconcileCardEntry(db,owner,key,invoice.id,before.revision,input);
  const after=await view('2028-01');expect(after.totals).toEqual(before.totals);expect(after.entries[0]!.reconciledFrom).toEqual([source.id]);
  const archived=(await db.get('transactions',source.id))!;expect(archived).toMatchObject({source:'ofx',externalId:'synthetic-reimport',reconciledIntoId:target.id,amount:'-100.00',competenceMonth:'2028-01-01'});expect(archived.archivedAt).toBeInstanceOf(Date);
  await expect(archiveEntry(db,owner,randomUUID(),source.id,revision(archived),false)).rejects.toMatchObject({code:'LINKED_ENTRY'});
  await expect(reconcileCardEntry(db,owner,randomUUID(),invoice.id,after.revision,{...input,sourceRevision:revision(archived)})).rejects.toMatchObject({code:'RECONCILE_CONFLICT'});
  await expect(db.put('transactions',{...source,id:randomUUID(),source:'ofx',externalId:'synthetic-reimport'})).rejects.toThrow('Duplicate unique');
  expect(monthTotals(await db.owned('transactions',owner),'2028-01').expenses).toBe(10000n);
});
it('credits partial refunds in another invoice while keeping original competence, caps total refunds and exposes divergence',async()=>{
  const source=await view('2028-01'),target=await view('2028-02'),original=source.entries[0]!;
  const cash=accountBalances([(await db.get('accounts',account))!],await db.owned('transactions',owner),'2028-02-29').get(account);
  const payload=item('2028-02',{type:'refund',description:'Estorno parcial',amount:'25.00',competenceMonth:'2028-01',refundOfId:original.id});
  await addInvoiceItem(db,owner,randomUUID(),target.id,target.revision,payload);
  const invoice=await view('2028-02');expect(invoice.totals).toMatchObject({credits:'25.00',computed:'75.00',remaining:'75.00'});expect(invoice.entries.find(e=>e.type==='refund')).toMatchObject({competenceMonth:'2028-01-01',refundOfId:original.id});
  expect(monthTotals(await db.owned('transactions',owner),'2028-01').expenses).toBe(7500n);
  expect(accountBalances([(await db.get('accounts',account))!],await db.owned('transactions',owner),'2028-02-29').get(account)).toBe(cash);
  await expect(addInvoiceItem(db,owner,randomUUID(),invoice.id,invoice.revision,{...payload,amount:'75.01'})).rejects.toMatchObject({code:'REFUND_LIMIT'});
  await expect(addInvoiceItem(db,owner,randomUUID(),invoice.id,invoice.revision,{...payload,competenceMonth:'2028-02'})).rejects.toMatchObject({code:'REFUND_CONFLICT'});
  await saveInvoice(db,owner,randomUUID(),card,'2028-02',invoice.revision,{statedTotal:'100.00',previousBalance:'0.00',closed:true});expect((await view('2028-02')).totals.divergence).toBe('25.00');
});
it('attaches a settled manual expense as card purchase and removes only its obsolete cash effect',async()=>{
  const source=await manual('2028-03',{amount:'22.22',status:'settled',paidDate:'2028-03-28'}),empty=await view('2028-03');await saveInvoice(db,owner,randomUUID(),card,'2028-03',empty.revision,{statedTotal:null,previousBalance:'0.00',closed:false});
  const invoice=await view('2028-03'),before=accountBalances([(await db.get('accounts',account))!],await db.owned('transactions',owner),'2028-03-28').get(account)!;
  await reconcileCardEntry(db,owner,randomUUID(),invoice.id,invoice.revision,{sourceId:source.id,sourceRevision:revision(source),targetId:null,targetRevision:null,confirmed:true});
  const linked=(await db.get('transactions',source.id))!;expect(linked).toMatchObject({invoiceId:invoice.id,status:'recorded',paidDate:null,cardOriginal:{kind:'expense',status:'settled',paidDate:'2028-03-28',competenceMonth:'2028-03-01'}});
  expect(accountBalances([(await db.get('accounts',account))!],await db.owned('transactions',owner),'2028-03-28').get(account)).toBe(before+2222n);expect((await view('2028-03')).totals.computed).toBe('22.22');
});
it('reclassifies an existing bank invoice payment without another cash movement, including request races',async()=>{
  const source=await manual('2028-03',{amount:'22.22',status:'settled',paidDate:'2028-03-28'}),invoice=await view('2028-03'),beforeCount=(await db.owned('transactions',owner)).length;
  const input=payment('22.22','2028-03-28',{transactionId:source.id,transactionRevision:revision(source)}),key=randomUUID();
  const results=await Promise.all([1,2].map(()=>payInvoice(db,owner,key,invoice.id,invoice.revision,input)));expect(results[0]).toEqual(results[1]);expect((await db.owned('transactions',owner)).length).toBe(beforeCount);
  expect((await db.get('transactions',source.id))!).toMatchObject({kind:'adjustment',status:'settled',invoiceId:invoice.id,cardEntryType:'payment',cardOriginal:{kind:'expense'}});
  expect(monthTotals(await db.owned('transactions',owner),'2028-03').expenses).toBe(2222n);expect((await view('2028-03')).totals.remaining).toBe('0.00');
});
it('reconciles a recurrence forecast with the invoice expense without settling card purchases into bank cash',async()=>{
  await addCardPurchase(db,owner,randomUUID(),card,purchase('2028-05',{count:1,totalAmount:'50.00'}));
  const rule=await saveRule(db,owner,randomUUID(),{fromMonth:'2028-05',schedule:{accountId:account,categoryId:category,description:'Previsto cartão',amount:'60.00',startDate:'2028-05-01',endDate:'2028-05-31',dueDay:30,estimated:true,reminderDays:null,paused:false}});await generateMonth(db,owner,randomUUID(),'2028-05');
  const occurrence=(await loadPlanning(db,owner,'2028-05')).occurrences.find(o=>o.ruleId===rule.id)!,invoice=await view('2028-05'),entry=invoice.entries[0]!;
  expect((await loadPlanning(db,owner,'2028-05')).summary.committed).toBe('110.00');
  await reconcileCardOccurrence(db,owner,randomUUID(),invoice.id,invoice.revision,{transactionId:entry.id,transactionRevision:entry.revision,occurrenceId:occurrence.id,occurrenceRevision:occurrence.revision,confirmed:true});
  const after=await loadPlanning(db,owner,'2028-05');expect(after.summary).toMatchObject({realized:'50.00',pending:'0.00',committed:'50.00'});expect((await db.get('transactions',entry.id))!).toMatchObject({status:'recorded',paidDate:null,recurrenceOccurrenceId:occurrence.id});expect((await view('2028-05')).totals.payments).toBe('0.00');
});
it('enforces owners, revision checks, explicit consent and closed months atomically across installment and settlement dates',async()=>{
  const before=(await db.owned('transactions',owner)).length;
  await expect(saveCard(db,owner,randomUUID(),{name:'Ataque',paymentAccountId:foreign,closingDay:10,dueDay:20})).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(addCardPurchase(db,other,randomUUID(),card,purchase('2028-06'))).rejects.toMatchObject({code:'NOT_FOUND'});await expect(addCardPurchase(db,owner,randomUUID(),card,purchase('2028-06',{confirmed:false}))).rejects.toThrow();
  const state=await loadPlanning(db,owner,'2028-07');await closeMonth(db,owner,randomUUID(),'2028-07',state.monthRevision,{action:'close'});
  await expect(addCardPurchase(db,owner,randomUUID(),card,purchase('2028-06'))).rejects.toMatchObject({code:'MONTH_CLOSED'});expect((await db.owned('transactions',owner)).length).toBe(before);expect((await view('2028-06')).revision).toBe('new');
  const invoice=await view('2028-05');await expect(payInvoice(db,owner,randomUUID(),invoice.id,invoice.revision,payment('1.00','2028-07-01'))).rejects.toMatchObject({code:'MONTH_CLOSED'});
  await expect(addInvoiceItem(db,other,randomUUID(),invoice.id,invoice.revision,item('2028-05'))).rejects.toMatchObject({code:'NOT_FOUND'});await expect(saveInvoice(db,owner,randomUUID(),card,'2028-05','stale',{statedTotal:null,previousBalance:'0.00',closed:false})).rejects.toMatchObject({code:'REVISION_CONFLICT'});
});
it('caps competing refunds across different invoices against the same original expense',async()=>{
  await addCardPurchase(db,owner,randomUUID(),card,purchase('2029-08',{count:1,totalAmount:'100.00'}));
  const original=(await view('2029-08')).entries[0]!;
  for(const month of ['2029-09','2029-10']){const empty=await view(month);await saveInvoice(db,owner,randomUUID(),card,month,empty.revision,{statedTotal:null,previousBalance:'0.00',closed:false});}
  const invoices=await Promise.all(['2029-09','2029-10'].map(view));
  const results=await Promise.allSettled(invoices.map(i=>addInvoiceItem(db,owner,randomUUID(),i.id,i.revision,item(i.month,{type:'refund',description:'Concorrente',amount:'60.00',competenceMonth:'2029-08',refundOfId:original.id}))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(monthTotals(await db.owned('transactions',owner),'2029-08').expenses).toBe(4000n);
});
it('commits the maximum 24 confirmed installments atomically within the native backup write limit',async()=>{
  const large=testStore('cards-large-'+randomBytes(6).toString('hex'));
  try {
    await migrateToFirebase(large,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));await clearTestCollections(large,[...collections.filter(c=>c!=='users'),'_unique','_migration']);
    const a=String((await saveAccount(large,owner,randomUUID(),{name:'Máximo',type:'carteira',openingBalance:'0.00',openingDate:'2000-01-01'})).id),c=String((await saveCategory(large,owner,randomUUID(),{name:'Máximo',color:'#112233'})).id),cardId=String((await saveCard(large,owner,randomUUID(),{name:'Máximo',paymentAccountId:a,closingDay:25,dueDay:5})).id);
    await addCardPurchase(large,owner,randomUUID(),cardId,purchase('2050-01',{categoryId:c,count:24,totalAmount:'240.01'}));
    expect(await large.owned('installments',owner)).toHaveLength(24);expect(await large.owned('invoices',owner)).toHaveLength(24);
    const entries=await large.owned('transactions',owner);expect(entries).toHaveLength(24);expect(entries.reduce((sum,e)=>sum+BigInt(e.amount.replace('.','')),0n)).toBe(-24001n);
    expect((await backupFirebase(large)).records.length).toBeLessThan(400);
  } finally {await clearTestCollections(large);await large.firestore.terminate();}
});
it('backs up and restores installment/refund/payment audit links without flattening new schema into frozen SQL',async()=>{
  const snapshot=await backupFirebase(db);await restoreFirebase(copy,snapshot);expect(await backupFirebase(copy)).toEqual(snapshot);await expect(exportPortableFirebase(db)).rejects.toThrow('schema v2');
});
