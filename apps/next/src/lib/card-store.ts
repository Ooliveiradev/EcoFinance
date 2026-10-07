import { randomUUID } from 'node:crypto';
import type { Database,Models } from '@ecofinance/db';
import { cardSchema,invoiceDates,invoiceTotals,type CardRecord,type CardEntryType } from '@ecofinance/shared';
import { operation,owned,checkRevision,revision,fail } from './finance-operation';
import { stableId,assertMonthOpen,touchMonths } from './planning-lock';
export function publicCard(row:Models['cards']):CardRecord {return {id:row.id,name:row.name,paymentAccountId:row.paymentAccountId,closingDay:row.closingDay,dueDay:row.dueDay,revision:revision(row),archived:!!row.archivedAt};}
export async function activeCard(tx:Database,owner:string,id:string) {
  const card=await owned(tx,'cards',id,owner);
  if(card.archivedAt)fail('ARCHIVED_CARD',409,'Restaure o cartão para alterar faturas.');
  return card;
}
export async function cardReference(tx:Database,owner:string,collection:'accounts'|'categories',id:string) {
  const row=await owned(tx,collection,id,owner);
  if(row.archivedAt)fail('ARCHIVED_REFERENCE',409,'Escolha uma conta e categoria ativas.');
  return row;
}
/** Query also supports historical UUID invoices imported from the frozen schema. */
export async function invoiceFor(tx:Database,owner:string,card:Models['cards'],month:string) {
  const existing=await tx.owned('invoices',owner,{where:[{field:'cardId',value:card.id},{field:'competenceMonth',value:month+'-01'}],limit:1});
  if(existing[0])return existing[0];
  const now=new Date();
  return {id:stableId(['invoice',owner,card.id,month]),ownerId:owner,cardId:card.id,competenceMonth:month+'-01',...invoiceDates(month,card.closingDay,card.dueDay),paymentAccountId:card.paymentAccountId,statedTotal:null,previousBalance:'0.00',closed:false,currency:'BRL',status:'open',createdAt:now,updatedAt:now,revision:'new'} satisfies Models['invoices'];
}
export async function invoiceContext(tx:Database,owner:string,id:string,expected:string) {
  const invoice=await owned(tx,'invoices',id,owner);checkRevision(invoice,expected);
  const card=await activeCard(tx,owner,invoice.cardId),month=invoice.competenceMonth.slice(0,7);
  await assertMonthOpen(tx,owner,month);
  const entries=await tx.owned('transactions',owner,{where:[{field:'invoiceId',value:id}]});
  return {invoice,card,month,entries};
}
export function updatedInvoice(row:Models['invoices'],entries:Models['transactions'][],card:Models['cards']) {
  const totals=invoiceTotals(entries,row.previousBalance??'0.00',row.statedTotal),paid=BigInt(totals.payments.replace('.','')),remaining=BigInt(totals.remaining.replace('.',''));
  const closed=row.closed??row.status!=='open';
  return {...row,paymentAccountId:row.paymentAccountId??card.paymentAccountId,previousBalance:row.previousBalance??'0.00',closed,status:paid>0n?(remaining<=0n?'paid':'partial'):(closed?'closed':'open'),revision:randomUUID(),updatedAt:new Date()};
}
export async function saveCard(db:Database,owner:string,key:string,input:unknown,id?:string,expected='') {
  const data=cardSchema.parse(input);
  return operation(db,owner,key,'save-card',{data,id:id??null,expected},async tx=>{
    const old=id?await owned(tx,'cards',id,owner):null;if(old)checkRevision(old,expected);
    await cardReference(tx,owner,'accounts',data.paymentAccountId);
    const now=new Date(),row={...data,id:old?.id??randomUUID(),ownerId:owner,currency:'BRL',archivedAt:old?.archivedAt??null,revision:randomUUID(),createdAt:old?.createdAt??now,updatedAt:now};
    await tx.put('cards',row,!old);return {id:row.id,revision:row.revision};
  });
}
export async function archiveCard(db:Database,owner:string,key:string,id:string,expected:string,archived:boolean) {
  return operation(db,owner,key,'archive-card',{id,expected,archived},async tx=>{
    const old=await owned(tx,'cards',id,owner);checkRevision(old,expected);
    const row={...old,archivedAt:archived?new Date():null,revision:randomUUID(),updatedAt:new Date()};await tx.put('cards',row);return {id,revision:row.revision};
  });
}
export function cardEntry(owner:string,invoice:Models['invoices'],accountId:string,categoryId:string,data:{description:string;amount:string;purchaseDate:string;competenceMonth:string;type:CardEntryType;paidDate?:string;refundOfId?:string|null;installmentId?:string|null}):Models['transactions'] {
  const now=new Date(),id=randomUUID(),payment=data.type==='payment';
  return {id,ownerId:owner,accountId,categoryId,description:data.description,amount:data.amount,kind:payment?'adjustment':['credit','refund'].includes(data.type)?'refund':'expense',status:payment?'settled':'recorded',currency:'BRL',purchaseDate:data.purchaseDate,competenceMonth:data.competenceMonth+'-01',dueDate:invoice.dueDate,paidDate:data.paidDate??null,reviewRequired:false,invoiceId:invoice.id,installmentId:data.installmentId??null,recurrenceOccurrenceId:null,archivedAt:null,date:new Date(data.purchaseDate+'T12:00:00Z'),category:'desconhecido',source:'manual',externalId:'card:'+id,latitude:null,longitude:null,uberMetadataId:null,notes:null,transferId:null,cardEntryType:data.type,refundOfId:data.refundOfId??null,revision:randomUUID(),createdAt:now,updatedAt:now};
}
export async function writeInvoiceChange(tx:Database,owner:string,invoice:Models['invoices'],card:Models['cards'],entries:Models['transactions'][],changed:Models['transactions'][],months:string[]) {
  const row=updatedInvoice(invoice,entries,card);
  await tx.put('invoices',row);await tx.putMany('transactions',changed);await touchMonths(tx,owner,[invoice.competenceMonth.slice(0,7),...months]);return {id:row.id,revision:row.revision};
}
