import { randomUUID } from 'node:crypto';
import type { Database } from '@ecofinance/db';
import { cardReconcileSchema,cardOccurrenceSchema,moneyToCents,centsToMoney } from '@ecofinance/shared';
import { operation,owned,checkRevision,fail } from './finance-operation';
import { assertMonthOpen } from './planning-lock';
import { invoiceContext,writeInvoiceChange } from './card-store';
import { occurrenceSnapshot } from './planning-rules';
export async function reconcileCardEntry(db:Database,owner:string,key:string,id:string,expected:string,input:unknown) {
  const data=cardReconcileSchema.parse(input);
  return operation(db,owner,key,'card-reconcile',{id,expected,data},async tx=>{
    const {invoice,card,entries,month}=await invoiceContext(tx,owner,id,expected),source=await owned(tx,'transactions',data.sourceId,owner);checkRevision(source,data.sourceRevision);
    if(source.invoiceId||source.installmentId||source.recurrenceOccurrenceId||source.transferId||source.reconciledIntoId||source.archivedAt||source.kind!=='expense'||!['recorded','settled'].includes(source.status)||source.accountId!==(invoice.paymentAccountId??card.paymentAccountId))fail('RECONCILE_CONFLICT',409,'Escolha uma despesa sem vínculos da conta de pagamento.');
    const oldMonth=source.competenceMonth.slice(0,7);await assertMonthOpen(tx,owner,oldMonth);
    const now=new Date();
    if(data.targetId) {
      const target=await owned(tx,'transactions',data.targetId,owner);checkRevision(target,data.targetRevision!);
      if(target.invoiceId!==id||target.kind!=='expense'||target.archivedAt||target.amount!==source.amount||target.status!=='recorded')fail('RECONCILE_CONFLICT',409,'A duplicata deve corresponder ao mesmo valor de uma despesa vigente desta fatura.');
      const archived={...source,archivedAt:now,reconciledIntoId:target.id,revision:randomUUID(),updatedAt:now};
      // The original signed amount, source, external identity and dates remain available for audit.
      return writeInvoiceChange(tx,owner,invoice,card,entries,[archived],[oldMonth,target.competenceMonth.slice(0,7)]);
    }
    const linked={...source,cardOriginal:{kind:source.kind,status:source.status,paidDate:source.paidDate,competenceMonth:source.competenceMonth},invoiceId:id,cardEntryType:'purchase' as const,status:'recorded',paidDate:null,competenceMonth:month+'-01',dueDate:invoice.dueDate,reviewRequired:false,notes:[source.notes,'Conciliação: status '+source.status+', competência '+source.competenceMonth+', pagamento '+(source.paidDate??'não informado')].filter(Boolean).join('\n').slice(0,2000),revision:randomUUID(),updatedAt:now};
    return writeInvoiceChange(tx,owner,invoice,card,[...entries,linked],[linked],[oldMonth]);
  });
}
export async function reconcileCardOccurrence(db:Database,owner:string,key:string,id:string,expected:string,input:unknown) {
  const data=cardOccurrenceSchema.parse(input);
  return operation(db,owner,key,'card-occurrence',{id,expected,data},async tx=>{
    const {invoice,card,entries}=await invoiceContext(tx,owner,id,expected),[entry,occurrence]=await Promise.all([owned(tx,'transactions',data.transactionId,owner),owned(tx,'recurrenceOccurrences',data.occurrenceId,owner)]);
    checkRevision(entry,data.transactionRevision);checkRevision(occurrence,data.occurrenceRevision);
    const rule=await owned(tx,'recurrenceRules',occurrence.ruleId,owner),snapshot=occurrenceSnapshot(occurrence,rule);
    if(entry.invoiceId!==id||entry.kind!=='expense'||entry.archivedAt||entry.status!=='recorded'||entry.recurrenceOccurrenceId||!['pending','postponed'].includes(occurrence.status)||occurrence.transactionId||occurrence.competenceMonth!==entry.competenceMonth||snapshot.accountId!==entry.accountId||snapshot.categoryId!==entry.categoryId)fail('OCCURRENCE_CONFLICT',409,'Escolha uma previsão pendente da mesma competência, conta e categoria da compra.');
    await assertMonthOpen(tx,owner,entry.competenceMonth.slice(0,7));
    const now=new Date(),updated={...entry,recurrenceOccurrenceId:occurrence.id,revision:randomUUID(),updatedAt:now};
    await tx.put('recurrenceOccurrences',{...occurrence,status:'paid',amount:centsToMoney(-moneyToCents(entry.amount)),snapshot,overridden:true,transactionId:entry.id,revision:randomUUID(),updatedAt:now});
    return writeInvoiceChange(tx,owner,invoice,card,entries.map(e=>e.id===entry.id?updated:e),[updated],[entry.competenceMonth.slice(0,7)]);
  });
}
