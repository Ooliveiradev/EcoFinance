import { beforeAll,afterAll,it,expect } from 'vitest';
import { randomUUID,randomBytes } from 'node:crypto';
import { testStore,clearTestCollections } from './firestore-fixture';
import { saveAccount,saveCategory,saveEntry,revision } from '../../../apps/next/src/lib/manual-finance-service';
import { saveCard } from '../../../apps/next/src/lib/card-store';
import { loadInvoice } from '../../../apps/next/src/lib/card-read';
import { reconcileCardEntry } from '../../../apps/next/src/lib/card-reconcile';
import { receiveImports,processImport,loadImport,reviewImportItem } from '../../../apps/next/src/lib/import-store';
import { confirmImport,undoImport } from '../../../apps/next/src/lib/import-commit';
import { loadReport } from '../../../apps/next/src/lib/metrics-read';
import { metricsCsv,type ImportBatchView,type ImportRowView } from '../../shared/src';
import { corpus,corpusBytes } from '../../../tests/fixtures/imports/corpus';

// Import pipeline → metrics: previews never reach confirmed numbers, and every
// commit, reconciliation, correction and undo shows up in report, cash view, projection,
// summary and CSV on the next read (nothing is cached as an aggregate). The
// dashboard renders the same report; tests/e2e/reports-imports.spec.ts checks it.
const db=testStore('metrics-imports-'+randomBytes(6).toString('hex'));
const owner='10000000-0000-4000-8000-000000000001',month='2026-10',now=new Date('2026-10-31T15:00:00Z');
let account:string,card:string,category:string;
beforeAll(async()=>{
  await clearTestCollections(db);
  await db.put('users',{id:owner,displayName:'Synthetic',email:null,emailVerified:false,image:null,createdAt:now,updatedAt:now});
  account=String((await saveAccount(db,owner,randomUUID(),{name:'Conta importada',type:'banco',openingBalance:'1000.00',openingDate:'2020-01-01'})).id);
  category=String((await saveCategory(db,owner,randomUUID(),{name:'Importados',color:'#336699'})).id);
  card=String((await saveCard(db,owner,randomUUID(),{name:'Cartão importado',paymentAccountId:account,closingDay:25,dueDay:5})).id);
});
afterAll(async()=>{await clearTestCollections(db);await db.firestore.terminate();});

const file=(name:string)=>({name,mime:corpus.find(entry=>entry.file===name)!.mime,bytes:corpusBytes(name)});
async function stage(name:string,target:{accountId:string|null;cardId:string|null}) {
  const received=(await receiveImports(db,owner,randomUUID(),[file(name)],target)).batches as {id:string;revision:string}[];
  return processImport(db,owner,received[0]!.id,received[0]!.revision);
}
async function review(batch:ImportBatchView,amounts:Record<string,string>={}) {
  for(const row of batch.rows)await reviewImportItem(db,owner,randomUUID(),batch.id,row.id,row.revision,{description:row.description,amount:amounts[row.description!]??row.amount,purchaseDate:row.purchaseDate,competenceMonth:row.competenceMonth,categoryId:category,selected:true,resolution:'new',duplicateId:null});
  return loadImport(db,owner,batch.id);
}
const confirm=async(id:string)=>{const batch=await loadImport(db,owner,id);return confirmImport(db,owner,randomUUID(),id,batch.revision,{confirmed:true});};
const undo=async(id:string)=>{const batch=await loadImport(db,owner,id);return undoImport(db,owner,randomUUID(),id,batch.revision,{confirmed:true});};

/** Every surface for the month, read the way the routes read it. */
async function surfaces() {
  const competence=await loadReport(owner,{from:month,to:month,basis:'competence'},now,db);
  const cash=await loadReport(owner,{from:month,to:month,basis:'cash'},now,db);
  const row=competence.report.months[0]!;
  // The category breakdown always adds up to the month's expenses.
  expect(competence.report.categories.reduce((sum,c)=>sum+Math.round(Number(c.amount)*100),0)).toBe(Math.round(Number(row.expenses)*100));
  const csv=metricsCsv(competence.report);
  for(const key of ['income','expenses','count'] as const)expect(csv).toContain(`mensal;${month};competência;${key};${row[key]}`);
  return {
    competence:{income:row.income,expenses:row.expenses,count:row.count},
    cash:{income:cash.report.months[0]!.income,expenses:cash.report.months[0]!.expenses},
    balance:competence.projection.balance,invoices:competence.projection.commitments.invoices,projected:competence.projection.projected,
    pending:competence.pendingImports,csv,
  };
}

it('keeps previews out of confirmed numbers and follows confirm, correction and undo on every surface',async()=>{
  const baseline=await surfaces();
  expect(baseline).toMatchObject({competence:{income:'0.00',expenses:'0.00',count:0},cash:{income:'0.00',expenses:'0.00'},balance:'1000.00',invoices:'0.00',pending:0});

  // 1. Two real files staged and reviewed: OFX SGML into the account, OFX XML into the card.
  const bank=await stage('ofx-sgml-1252.ofx',{accountId:account,cardId:null});
  const cardBatch=await stage('ofx-xml-card.ofx',{accountId:null,cardId:card});
  expect([bank.state,cardBatch.state]).toEqual(['review','review']);
  // Correction before commit: the fee line is fixed in review.
  const reviewed=await review(bank,{'Tarifa & serviços':'-20.00'});
  expect(reviewed.preview).toEqual([{month,income:'1503.50',expenses:'65.90',balance:'1437.60'}]);
  const reviewedCard=await review(cardBatch);
  expect(reviewedCard.preview.length).toBe(1);
  const previewing=await surfaces();
  // The preview exists only in the import batch: every confirmed number is unchanged.
  expect({...previewing,pending:0,csv:''}).toEqual({...baseline,csv:''});
  expect(previewing.csv).toBe(baseline.csv);
  expect(previewing.pending).toBe(2);
  expect(await db.owned('transactions',owner)).toHaveLength(0);

  // 2. Confirm the account batch: competence and cash both move, with the corrected fee.
  await confirm(bank.id);
  expect(await surfaces()).toMatchObject({competence:{income:'1503.50',expenses:'65.90',count:4},cash:{income:'1503.50',expenses:'65.90'},balance:'2437.60',invoices:'0.00',pending:1});

  // 3. Confirm the card batch: purchases and the credit count by competence only; the
  // open invoice becomes a commitment and the account balance does not move.
  await confirm(cardBatch.id);
  const invoice=await loadInvoice(db,owner,card,month);
  expect(invoice.totals.remaining).toBe('309.90');
  expect(await surfaces()).toMatchObject({competence:{income:'1503.50',expenses:'375.80',count:7},cash:{income:'1503.50',expenses:'65.90'},balance:'2437.60',invoices:'309.90',projected:'2127.70',pending:0});

  // 3b. Reconciliation: the bank also listed the card purchase. While it is a separate
  // expense it counts twice; reconciling it into the imported card entry removes it everywhere.
  const duplicate=await saveEntry(db,owner,randomUUID(),{accountId:account,categoryId:category,toAccountId:null,description:'Livraria no extrato',amount:'89.90',kind:'expense',status:'settled',purchaseDate:month+'-03',competenceMonth:month+'-01',dueDate:null,paidDate:month+'-03',notes:null});
  expect(await surfaces()).toMatchObject({competence:{expenses:'465.70',count:8},cash:{expenses:'155.80'},balance:'2347.70'});
  const target=invoice.entries.find(entry=>entry.amount==='-89.90')!,source=(await db.get('transactions',String(duplicate.id)))!;
  await reconcileCardEntry(db,owner,randomUUID(),invoice.id,invoice.revision,{sourceId:source.id,sourceRevision:revision(source),targetId:target.id,targetRevision:target.revision,confirmed:true});
  expect(await surfaces()).toMatchObject({competence:{income:'1503.50',expenses:'375.80',count:7},cash:{expenses:'65.90'},balance:'2437.60',invoices:'309.90'});

  // 4. Correction after commit: editing an imported entry updates the next read.
  const bakery=(await db.owned('transactions',owner,{where:[{field:'accountId',value:account},{field:'invoiceId',value:null}]})).find(row=>row.amount==='-45.90')!;
  await saveEntry(db,owner,randomUUID(),{accountId:account,categoryId:category,toAccountId:null,description:bakery.description,amount:'40.00',kind:'expense',status:'settled',purchaseDate:bakery.purchaseDate,competenceMonth:bakery.competenceMonth,dueDate:null,paidDate:bakery.paidDate,notes:null},bakery.id,revision(bakery));
  expect(await surfaces()).toMatchObject({competence:{income:'1503.50',expenses:'369.90',count:7},cash:{expenses:'60.00'},balance:'2443.50'});

  // 5. Undo the account batch: the edited entry is preserved, the other three leave every total.
  const undone=await undo(bank.id);
  expect(undone).toMatchObject({archived:3,preserved:1});
  const rows=(await loadImport(db,owner,bank.id)).rows as ImportRowView[];
  expect(rows.filter(row=>row.undoReason?.startsWith('Preservado'))).toHaveLength(1);
  expect(await surfaces()).toMatchObject({competence:{income:'0.00',expenses:'349.90',count:4},cash:{income:'0.00',expenses:'40.00'},balance:'960.00',invoices:'309.90',pending:0});

  // 6. Undo the card batch: the invoice commitment disappears with its entries.
  await undo(cardBatch.id);
  expect(await surfaces()).toMatchObject({competence:{income:'0.00',expenses:'40.00',count:1},cash:{expenses:'40.00'},balance:'960.00',invoices:'0.00',projected:'960.00',pending:0});
});
