import { randomUUID } from 'node:crypto';
import type { Database,Models } from '@ecofinance/db';
import { cardPurchaseSchema,installmentPlan,invoiceSchema,invoiceItemSchema,moneyToCents,centsToMoney,invoiceTotals,planningMonthSchema,invoicePaymentSchema } from '@ecofinance/shared';
import { operation,owned,checkRevision,fail } from './finance-operation';
import { assertMonthOpen,touchMonths } from './planning-lock';
import { activeCard,cardReference,invoiceFor,cardEntry,updatedInvoice,invoiceContext,writeInvoiceChange } from './card-store';
export async function saveInvoice(db:Database,owner:string,key:string,cardId:string,month:string,expected:string,input:unknown) {
  const data=invoiceSchema.parse(input);planningMonthSchema.parse(month);
  return operation(db,owner,key,'save-invoice',{cardId,month,expected,data},async tx=>{
    const card=await activeCard(tx,owner,cardId),invoice=await invoiceFor(tx,owner,card,month);checkRevision(invoice,expected);await assertMonthOpen(tx,owner,month);
    const entries=await tx.owned('transactions',owner,{where:[{field:'invoiceId',value:invoice.id}]});
    const row=updatedInvoice({...invoice,...data},entries,card);
    await tx.put('invoices',row);await touchMonths(tx,owner,[month]);return {id:row.id,revision:row.revision};
  });
}
export async function addCardPurchase(db:Database,owner:string,key:string,cardId:string,input:unknown) {
  const data=cardPurchaseSchema.parse(input),parts=installmentPlan(data);
  return operation(db,owner,key,'card-purchase',{cardId,data},async tx=>{
    const card=await activeCard(tx,owner,cardId);await cardReference(tx,owner,'accounts',card.paymentAccountId);await cardReference(tx,owner,'categories',data.categoryId);
    const months=parts.map(p=>p.month);await Promise.all(months.map(m=>assertMonthOpen(tx,owner,m)));
    const invoices=await Promise.all(months.map(m=>invoiceFor(tx,owner,card,m)));
    // Read every invoice before staging any writes; each invoice's old dates/account are frozen.
    const existing=await Promise.all(invoices.map(i=>tx.owned('transactions',owner,{where:[{field:'invoiceId',value:i.id}]})));
    const now=new Date(),group:Models['installmentGroups']={id:randomUUID(),ownerId:owner,cardId,description:data.description,totalAmount:data.totalAmount,count:data.count,purchaseDate:data.purchaseDate,currency:'BRL',createdAt:now,updatedAt:now};
    const installments:Models['installments'][]=parts.map((p,i)=>({id:randomUUID(),ownerId:owner,groupId:group.id,invoiceId:invoices[i]!.id,number:p.number,amount:p.amount,competenceMonth:p.month+'-01',createdAt:now,updatedAt:now}));
    const entries=parts.map((p,i)=>cardEntry(owner,invoices[i]!,invoices[i]!.paymentAccountId??card.paymentAccountId,data.categoryId,{description:data.description,amount:centsToMoney(-moneyToCents(p.amount)),purchaseDate:data.purchaseDate,competenceMonth:p.month,type:'purchase',installmentId:installments[i]!.id}));
    const updated=invoices.map((row,i)=>updatedInvoice(row,[...existing[i]!,entries[i]!],card));
    await tx.putMany('invoices',updated);await tx.put('installmentGroups',group,true);await tx.putMany('installments',installments);await tx.putMany('transactions',entries);await touchMonths(tx,owner,months);
    return {id:group.id,revision:'created',invoiceIds:updated.map(i=>i.id),transactionIds:entries.map(e=>e.id)};
  });
}
export async function addInvoiceItem(db:Database,owner:string,key:string,id:string,expected:string,input:unknown) {
  const data=invoiceItemSchema.parse(input);
  return operation(db,owner,key,'invoice-item',{id,expected,data},async tx=>{
    const {invoice,card,entries}=await invoiceContext(tx,owner,id,expected);await cardReference(tx,owner,'categories',data.categoryId);await assertMonthOpen(tx,owner,data.competenceMonth);
    if(data.refundOfId) {
      const original=await owned(tx,'transactions',data.refundOfId,owner);
      if(!original.invoiceId || original.kind!=='expense'||original.archivedAt||original.status!=='recorded')fail('REFUND_CONFLICT',409,'Escolha uma despesa vigente do cartão.');
      const sourceInvoice=await owned(tx,'invoices',original.invoiceId!,owner);
      if(sourceInvoice.cardId!==card.id || original.competenceMonth!==data.competenceMonth+'-01' || original.categoryId!==data.categoryId)fail('REFUND_CONFLICT',409,'O estorno mantém o cartão, a competência e a categoria da despesa original.');
      const refunds=await tx.owned('transactions',owner,{where:[{field:'refundOfId',value:original.id},{field:'archivedAt',value:null}]});
      if(refunds.reduce((sum,r)=>sum+moneyToCents(r.amount),moneyToCents(data.amount))>-moneyToCents(original.amount))fail('REFUND_LIMIT',409,'O total de estornos não pode superar a despesa original.');
    }
    const credit=['credit','refund'].includes(data.type),row=cardEntry(owner,invoice,invoice.paymentAccountId??card.paymentAccountId,data.categoryId,{...data,amount:centsToMoney(moneyToCents(data.amount)*(credit?1n:-1n))});
    return writeInvoiceChange(tx,owner,invoice,card,[...entries,row],[row],[data.competenceMonth]);
  });
}
export async function payInvoice(db:Database,owner:string,key:string,id:string,expected:string,input:unknown) {
  const data=invoicePaymentSchema.parse(input);
  return operation(db,owner,key,'invoice-payment',{id,expected,data},async tx=>{
    const {invoice,card,entries}=await invoiceContext(tx,owner,id,expected),account=invoice.paymentAccountId??card.paymentAccountId;
    await cardReference(tx,owner,'accounts',account);await cardReference(tx,owner,'categories',data.categoryId);await assertMonthOpen(tx,owner,data.paidDate.slice(0,7));
    const remaining=invoiceTotals(entries,invoice.previousBalance??'0.00',invoice.statedTotal).remaining;
    if(moneyToCents(data.amount)>BigInt(remaining.replace('.','')))fail('PAYMENT_LIMIT',409,'O pagamento não pode superar o saldo calculado da fatura. Confira os itens e o saldo anterior.');
    let row=cardEntry(owner,invoice,account,data.categoryId,{type:'payment',description:'Pagamento da fatura '+card.name,amount:centsToMoney(-moneyToCents(data.amount)),purchaseDate:data.paidDate,paidDate:data.paidDate,competenceMonth:data.paidDate.slice(0,7)});
    let sourceMonth:string|null=null;
    if(data.transactionId) {
      const source=await owned(tx,'transactions',data.transactionId,owner);checkRevision(source,data.transactionRevision!);
      if(source.invoiceId||source.installmentId||source.recurrenceOccurrenceId||source.transferId||source.archivedAt||!['expense','adjustment'].includes(source.kind)||source.status!=='settled'||source.amount!==row.amount||source.paidDate!==data.paidDate||source.accountId!==account)fail('PAYMENT_CONFLICT',409,'Escolha uma saída liquidada da conta de pagamento, com o mesmo valor e data, sem outros vínculos.');
      sourceMonth=source.competenceMonth.slice(0,7);await assertMonthOpen(tx,owner,sourceMonth);
      row={...source,cardOriginal:{kind:source.kind,status:source.status,paidDate:source.paidDate,competenceMonth:source.competenceMonth},kind:'adjustment',cardEntryType:'payment',invoiceId:id,revision:randomUUID(),updatedAt:new Date()};
    }
    return writeInvoiceChange(tx,owner,invoice,card,[...entries,row],[row],[data.paidDate.slice(0,7),...(sourceMonth?[sourceMonth]:[])]);
  });
}
