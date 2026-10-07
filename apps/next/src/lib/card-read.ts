import type { Database } from '@ecofinance/db';
import { planningMonthSchema,invoiceTotals,type InvoiceView,type CardEntryType } from '@ecofinance/shared';
import { owned,revision } from './finance-operation';
import { invoiceFor } from './card-store';
import { monthState } from './planning-lock';
import { occurrenceSnapshot } from './planning-rules';
export async function loadInvoice(db:Database,owner:string,cardId:string,month:string):Promise<InvoiceView> {
  planningMonthSchema.parse(month);
  return db.transaction(async tx=>{
    const card=await owned(tx,'cards',cardId,owner),invoice=await invoiceFor(tx,owner,card,month),[state,entries]=await Promise.all([monthState(tx,owner,month),tx.owned('transactions',owner,{where:[{field:'invoiceId',value:invoice.id},{field:'archivedAt',value:null}],order:[{field:'purchaseDate',direction:'asc'},{field:'id',direction:'asc'}]})]);
    const projected=await Promise.all(entries.map(async e=>{
      const [installment,sources]=await Promise.all([e.installmentId?owned(tx,'installments',e.installmentId,owner):null,tx.owned('transactions',owner,{where:[{field:'reconciledIntoId',value:e.id}]})]);
      const group=installment?await owned(tx,'installmentGroups',installment.groupId,owner):null;
      return {id:e.id,categoryId:e.categoryId,description:e.description,amount:e.amount,kind:e.kind,competenceMonth:e.competenceMonth,purchaseDate:e.purchaseDate,paidDate:e.paidDate,revision:revision(e),type:e.cardEntryType??(e.kind==='refund'?'credit':'purchase') as CardEntryType,installmentNumber:installment?.number??null,installmentCount:group?.count??null,refundOfId:e.refundOfId??null,recurrenceOccurrenceId:e.recurrenceOccurrenceId??null,source:e.source,reconciledFrom:sources.map(s=>s.id)};
    }));
    return {id:invoice.id,revision:revision(invoice),month,closingDate:invoice.closingDate,dueDate:invoice.dueDate,statedTotal:invoice.statedTotal,previousBalance:invoice.previousBalance??'0.00',closed:invoice.closed??invoice.status!=='open',status:invoice.status,paymentAccountId:invoice.paymentAccountId??card.paymentAccountId,entries:projected,totals:invoiceTotals(entries,invoice.previousBalance??'0.00',invoice.statedTotal),monthClosed:!!state.closedAt};
  });
}
export async function cardCandidates(db:Database,owner:string,id:string) {
  return db.transaction(async tx=>{
    const invoice=await owned(tx,'invoices',id,owner),card=await owned(tx,'cards',invoice.cardId,owner),accountId=invoice.paymentAccountId??card.paymentAccountId;
    const [sources,occurrences]=await Promise.all([tx.owned('transactions',owner,{where:[{field:'accountId',value:accountId},{field:'invoiceId',value:null},{field:'archivedAt',value:null},{field:'status',op:'in',value:['recorded','settled']}],order:[{field:'purchaseDate',direction:'desc'},{field:'id',direction:'asc'}],limit:101}),tx.owned('recurrenceOccurrences',owner,{where:[{field:'competenceMonth',value:invoice.competenceMonth},{field:'status',op:'in',value:['pending','postponed']}],limit:101})]);
    const forecasts=await Promise.all(occurrences.slice(0,100).map(async o=>{
      const rule=await owned(tx,'recurrenceRules',o.ruleId,owner),snapshot=occurrenceSnapshot(o,rule);
      return {id:o.id,description:snapshot.description,amount:o.amount,revision:revision(o),accountId:snapshot.accountId,categoryId:snapshot.categoryId};
    }));
    return {entries:sources.slice(0,100).filter(e=>!e.installmentId&&!e.recurrenceOccurrenceId&&!e.transferId&&!e.reconciledIntoId&&['expense','adjustment'].includes(e.kind)).map(e=>({id:e.id,description:e.description,amount:e.amount,kind:e.kind,status:e.status,competenceMonth:e.competenceMonth,purchaseDate:e.purchaseDate,revision:revision(e),source:e.source,accountId:e.accountId})),occurrences:forecasts.filter(f=>f.accountId===accountId),hasMore:sources.length>100||occurrences.length>100};
  });
}
