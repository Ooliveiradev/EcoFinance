import { randomUUID } from 'node:crypto';
import type { Database,Models } from '@ecofinance/db';
import { occurrenceEditSchema,paymentSchema,reconciliationSchema,postponementSchema,centsToMoney,moneyToCents } from '@ecofinance/shared';
import { operation,owned,checkRevision,fail } from './finance-operation';
import { assertMonthOpen,touchMonth } from './planning-lock';
import { occurrenceSnapshot,activeScheduleReferences } from './planning-rules';
async function editable(tx:Database,ownerId:string,id:string,expected:string) {
  const row=await owned(tx,'recurrenceOccurrences',id,ownerId);checkRevision(row,expected);
  await assertMonthOpen(tx,ownerId,row.competenceMonth.slice(0,7));
  if(row.status==='paid')fail('ALREADY_PAID',409,'Esta ocorrência já foi paga. O histórico pago é preservado.');
  const rule=await owned(tx,'recurrenceRules',row.ruleId,ownerId);
  return {...row,snapshot:occurrenceSnapshot(row,rule)};
}
export async function changeOccurrence(db:Database,ownerId:string,requestId:string,id:string,expected:string,action:'edit'|'postpone'|'cancel'|'restore',input:unknown) {
  const data=action==='edit'?occurrenceEditSchema.parse(input):action==='postpone'?postponementSchema.parse(input):empty(input);
  return operation(db,ownerId,requestId,'occurrence-'+action,{id,expected,data},async tx=>{
    const row=await editable(tx,ownerId,id,expected),now=new Date();
    const update=action==='edit'?data as ReturnType<typeof occurrenceEditSchema.parse>:null;
    const due=action==='postpone'?(data as {dueDate:string}).dueDate:update?.dueDate??row.dueDate;
    const next={...row,snapshot:update?{...row.snapshot,description:update.description,amount:update.amount}:row.snapshot,amount:update?.amount??row.amount,dueDate:due,status:action==='cancel'?'cancelled' as const:action==='postpone'?'postponed' as const:'pending' as const,overridden:true,revision:randomUUID(),updatedAt:now};
    await tx.put('recurrenceOccurrences',next);await touchMonth(tx,ownerId,row.competenceMonth.slice(0,7));
    return {id,revision:next.revision};
  });
}
function empty(input:unknown) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)fail('INVALID_INPUT',400,'Ação inválida.');
  return {};
}
function paidEntry(ownerId:string,row:Models['recurrenceOccurrences'],snapshot:NonNullable<Models['recurrenceOccurrences']['snapshot']>,amount:string,paidDate:string):Models['transactions'] {
  const now=new Date();
  return {id:randomUUID(),ownerId,accountId:snapshot.accountId,categoryId:snapshot.categoryId,description:snapshot.description,amount:centsToMoney(-moneyToCents(amount)),currency:'BRL',kind:'expense',status:'settled',purchaseDate:row.dueDate,competenceMonth:row.competenceMonth,dueDate:row.dueDate,paidDate,notes:null,transferId:null,revision:randomUUID(),reviewRequired:false,archivedAt:null,invoiceId:null,installmentId:null,recurrenceOccurrenceId:row.id,date:new Date(row.dueDate+'T12:00:00Z'),category:'desconhecido',source:'manual',externalId:'recurrence:'+row.id,latitude:null,longitude:null,uberMetadataId:null,createdAt:now,updatedAt:now};
}
export async function payOccurrence(db:Database,ownerId:string,requestId:string,id:string,expected:string,input:unknown,reconcile=false) {
  const data=reconcile?reconciliationSchema.parse(input):paymentSchema.parse(input);
  return operation(db,ownerId,requestId,reconcile?'reconcile-occurrence':'pay-occurrence',{id,expected,data},async tx=>{
    const row=await editable(tx,ownerId,id,expected);
    if(row.status==='cancelled')fail('CANCELLED',409,'Restaure a ocorrência antes de pagar.');
    let entry:Models['transactions'];
    if('transactionId' in data) {
      const imported=await owned(tx,'transactions',data.transactionId,ownerId);checkRevision(imported,data.transactionRevision);
      if(!['ofx','csv','spreadsheet','document','email','notification','pluggy','uber'].includes(imported.source)|| imported.kind!=='expense' || !['recorded','settled'].includes(imported.status) || imported.archivedAt || imported.recurrenceOccurrenceId || imported.invoiceId || imported.installmentId || imported.transferId || imported.competenceMonth!==row.competenceMonth || imported.accountId!==row.snapshot.accountId)fail('RECONCILIATION_CONFLICT',409,'Escolha uma despesa importada livre, da mesma conta e competência.');
      if(imported.status==='settled' && imported.paidDate!==data.paidDate)fail('RECONCILIATION_CONFLICT',409,'Preserve a data de pagamento do lançamento já liquidado.');
      entry={...imported,status:'settled',paidDate:data.paidDate,categoryId:row.snapshot.categoryId,recurrenceOccurrenceId:id,revision:randomUUID(),updatedAt:new Date()};
    } else {
      await activeScheduleReferences(tx,ownerId,row.snapshot,row.snapshot);
      entry=paidEntry(ownerId,row,row.snapshot,data.amount,data.paidDate);
    }
    await owned(tx,'categories',row.snapshot.categoryId,ownerId);
    await tx.put('transactions',entry);
    const next={...row,status:'paid' as const,amount:centsToMoney(-moneyToCents(entry.amount)),transactionId:entry.id,revision:randomUUID(),updatedAt:new Date()};
    await tx.put('recurrenceOccurrences',next);await touchMonth(tx,ownerId,row.competenceMonth.slice(0,7));
    return {id,revision:next.revision,transactionId:entry.id};
  });
}
