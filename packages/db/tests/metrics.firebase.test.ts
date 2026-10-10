import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID,randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { collections,type DocumentStore } from '../src/firestore';
import { testStore,clearTestCollections } from './firestore-fixture';
import { migrateToFirebase } from '../src/firebase-migration';
import { saveAccount,saveCategory,saveEntry } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard } from '../../../apps/next/src/lib/card-store';
import { addCardPurchase,addInvoiceItem,payInvoice } from '../../../apps/next/src/lib/card-purchases';
import { loadInvoice } from '../../../apps/next/src/lib/card-read';
import { saveRule,generateMonth } from '../../../apps/next/src/lib/planning-rules';
import { payOccurrence } from '../../../apps/next/src/lib/planning-occurrences';
import { loadPlanning } from '../../../apps/next/src/lib/planning-read';
import { saveBudget } from '../../../apps/next/src/lib/planning-budget';
import { loadReport } from '../../../apps/next/src/lib/metrics-read';
import { metricsCsv,monthlyDueDate } from '../../shared/src';
const db=testStore('metrics-'+randomBytes(6).toString('hex'));
const owner='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000001',month='2029-03',now=new Date('2029-03-31T15:00:00Z');
let main:string,savings:string,food:string,rent:string,salary:string,card:string;
const entry=(patch:Record<string,unknown>)=>({accountId:main,categoryId:food,toAccountId:null,description:'Lançamento',amount:'1.00',kind:'expense',status:'settled',purchaseDate:month+'-05',competenceMonth:month+'-01',dueDate:null,paidDate:month+'-05',...patch});
const rule=(description:string,amount:string,dueDay:number)=>({fromMonth:month,schedule:{accountId:main,categoryId:rent,description,amount,startDate:month+'-01',endDate:monthlyDueDate(month,31),dueDay,estimated:false,reminderDays:null,paused:false}});
beforeAll(async()=>{
  await migrateToFirebase(db,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));
  await clearTestCollections(db,[...collections.filter(c=>c!=='users'),'_unique','_migration']);
  const opening={type:'carteira',openingDate:'2029-01-01'};
  main=String((await saveAccount(db,owner,randomUUID(),{...opening,name:'Principal',openingBalance:'1000.00'})).id);
  savings=String((await saveAccount(db,owner,randomUUID(),{...opening,name:'Reserva',openingBalance:'0.00'})).id);
  const category=async(name:string)=>String((await saveCategory(db,owner,randomUUID(),{name,color:'#226688'})).id);
  [food,rent,salary]=[await category('Mercado'),await category('Moradia'),await category('Salário')];
  // Known dataset: salary, own transfer, paid and pending recurrences, budget with expected income,
  // card purchase in 3 installments, partial refund, partial invoice payment, planned expense,
  // another owner's movement and months without movements.
  await saveEntry(db,owner,randomUUID(),entry({categoryId:salary,description:'Salário',amount:'5000.00',kind:'income'}));
  await saveEntry(db,owner,randomUUID(),entry({toAccountId:savings,description:'Reserva',amount:'300.00',kind:'transfer',paidDate:month+'-06'}));
  await saveEntry(db,owner,randomUUID(),entry({description:'Previsto',amount:'50.00',status:'planned',paidDate:null}));
  const foreign=String((await saveAccount(db,other,randomUUID(),{...opening,name:'Outro',openingBalance:'0.00'})).id),foreignCategory=String((await saveCategory(db,other,randomUUID(),{name:'Outro',color:'#000000'})).id);
  await saveEntry(db,other,randomUUID(),entry({accountId:foreign,categoryId:foreignCategory,amount:'999.00',kind:'income'}));
  const rentRule=String((await saveRule(db,owner,randomUUID(),rule('Aluguel','1500.00',10))).id);
  await saveRule(db,owner,randomUUID(),rule('Internet','120.00',20));
  await generateMonth(db,owner,randomUUID(),month);
  const occurrence=(await loadPlanning(db,owner,month)).occurrences.find(o=>o.ruleId===rentRule)!;
  await payOccurrence(db,owner,randomUUID(),occurrence.id,occurrence.revision,{amount:'1500.00',paidDate:month+'-10'});
  await saveBudget(db,owner,randomUUID(),month,{limit:'3000.00',expectedIncome:'6000.00',reserve:'0.00',categories:[]},'');
  card=String((await saveCard(db,owner,randomUUID(),{name:'Cartão',paymentAccountId:main,closingDay:25,dueDay:5})).id);
  await addCardPurchase(db,owner,randomUUID(),card,{description:'Geladeira',categoryId:food,totalAmount:'300.00',count:3,purchaseDate:month+'-02',firstMonth:month,confirmed:true});
  let invoice=await loadInvoice(db,owner,card,month);
  await addInvoiceItem(db,owner,randomUUID(),invoice.id,invoice.revision,{type:'refund',description:'Estorno',amount:'40.00',categoryId:food,purchaseDate:month+'-12',competenceMonth:month,refundOfId:invoice.entries[0]!.id});
  invoice=await loadInvoice(db,owner,card,month);
  await payInvoice(db,owner,randomUUID(),invoice.id,invoice.revision,{amount:'50.00',paidDate:month+'-28',categoryId:food,transactionId:null,transactionRevision:null,confirmed:true});
});
afterAll(async()=>{await clearTestCollections(db);await db.firestore.terminate();});

it('separates competence and cash without transfers or double-counted card payments',async()=>{
  const competence=(await loadReport(owner,{from:month,to:month,basis:'competence'},now,db)).report;
  expect(competence.months[0]).toMatchObject({income:'5000.00',expenses:'1560.00',net:'3440.00',fixed:'1560.00',variable:'0.00',count:4});
  const cash=(await loadReport(owner,{from:month,to:month,basis:'cash'},now,db)).report;
  expect(cash.months[0]).toMatchObject({income:'5000.00',expenses:'1550.00',count:3});
});

it('matches planning and invoice views, projects availability and never counts paid recurrences as pending',async()=>{
  const {report,projection}=await loadReport(owner,{from:month,to:month},now,db);
  const planning=await loadPlanning(db,owner,month),invoice=await loadInvoice(db,owner,card,month);
  expect(report.plan[0]).toMatchObject({planned:true,realized:planning.summary.realized,pending:planning.summary.pending,committed:planning.summary.committed,remaining:planning.summary.remaining});
  expect(report.plan[0]).toMatchObject({realized:'1560.00',pending:'120.00',remaining:'1320.00'});
  expect(invoice.totals.remaining).toBe('10.00');
  expect(projection).toMatchObject({
    received:'5000.00',expectedIncome:'6000.00',toReceive:'1000.00',realized:'1560.00',
    commitments:{recurring:'120.00',planned:'50.00',invoices:'10.00',total:'180.00'},
    balance:'4450.00',projected:'5270.00',
  });
});

it('keeps owners isolated, reports empty months without invented trends and exports the same values',async()=>{
  const {report}=await loadReport(owner,{from:'2029-04',to:'2029-07',basis:'competence'},now,db);
  expect(report.months.map(row=>[row.month,row.expenses])).toEqual([['2029-04','100.00'],['2029-05','100.00'],['2029-06','0.00'],['2029-07','0.00']]);
  expect(report.months[0]!.trend.income.direction).toBe('down');
  expect(report.months[3]!.trend.expenses.direction).toBe('unknown');
  expect(report.plan.every(row=>!row.planned && row.remaining===null)).toBe(true);
  const foreign=(await loadReport(other,{from:month,to:month},now,db)).report;
  expect(foreign.totals).toMatchObject({income:'999.00',expenses:'0.00',count:1});
  const csv=metricsCsv((await loadReport(owner,{from:month,to:month},now,db)).report);
  expect(csv).toContain('mensal;2029-03;competência;expenses;1560.00');expect(csv).not.toContain('999.00');
});

it('propagates read failures and invalid filters instead of returning zero totals',async()=>{
  const unavailable=async()=>{throw new Error('unavailable');},broken={transaction:unavailable,owned:unavailable} as unknown as DocumentStore;
  await expect(loadReport(owner,{from:month,to:month},now,broken)).rejects.toThrow('unavailable');
  await expect(loadReport(owner,{from:month,to:'2030-03'},now,db)).rejects.toMatchObject({name:'ZodError'});
  await expect(loadReport(owner,{from:month,to:month,ownerId:other},now,db)).rejects.toMatchObject({name:'ZodError'});
});
