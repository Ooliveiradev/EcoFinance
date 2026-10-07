import { z } from 'zod';
import { moneySchema,moneyToCents,centsToMoney,civilDateSchema } from './finance';
import { planningMonthSchema,monthlyDueDate } from './planning';
import { shiftMonth } from './month';
import { decimalCents } from './manual-finance';
const positive=moneySchema.refine(v=>moneyToCents(v)>0n,'Informe um valor maior que zero.');
const uuid=z.string().uuid(),version=z.string().min(1).max(128);
export const cardSchema=z.object({name:z.string().trim().min(1).max(120),paymentAccountId:uuid,closingDay:z.number().int().min(1).max(31),dueDay:z.number().int().min(1).max(31)}).strict();
export const invoiceSchema=z.object({statedTotal:moneySchema.nullable(),previousBalance:moneySchema,closed:z.boolean()}).strict();
export const cardPurchaseSchema=z.object({description:z.string().trim().min(1).max(500),categoryId:uuid,totalAmount:positive,count:z.number().int().min(1).max(24),purchaseDate:civilDateSchema,firstMonth:planningMonthSchema,confirmed:z.literal(true)}).strict().superRefine((v,c)=>{
  if(moneyToCents(v.totalAmount)<BigInt(v.count))c.addIssue({code:'custom',path:['count'],message:'Cada parcela deve ter ao menos um centavo.'});
  if(!shiftMonth(v.firstMonth,v.count-1))c.addIssue({code:'custom',path:['firstMonth'],message:'Parcelas fora do período suportado.'});
});
export const invoiceItemSchema=z.object({type:z.enum(['interest','fee','credit','refund']),description:z.string().trim().min(1).max(500),amount:positive,categoryId:uuid,purchaseDate:civilDateSchema,competenceMonth:planningMonthSchema,refundOfId:uuid.nullable()}).strict().refine(v=>(v.type==='refund')===(v.refundOfId!==null),'Escolha a compra original apenas para estornos.');
export const invoicePaymentSchema=z.object({amount:positive,paidDate:civilDateSchema,categoryId:uuid,transactionId:uuid.nullable(),transactionRevision:version.nullable(),confirmed:z.literal(true)}).strict().refine(v=>(v.transactionId===null)===(v.transactionRevision===null),'Revise o lançamento existente.');
export const cardReconcileSchema=z.object({sourceId:uuid,sourceRevision:version,targetId:uuid.nullable(),targetRevision:version.nullable(),confirmed:z.literal(true)}).strict().refine(v=>(v.targetId===null)===(v.targetRevision===null),'Revise o destino.');
export const cardOccurrenceSchema=z.object({transactionId:uuid,transactionRevision:version,occurrenceId:uuid,occurrenceRevision:version,confirmed:z.literal(true)}).strict();
export type CardInput=z.infer<typeof cardSchema>;
export type CardEntryType='purchase'|'interest'|'fee'|'credit'|'refund'|'payment';
export function invoiceDates(month:string,closingDay:number,dueDay:number) {
  const closingDate=monthlyDueDate(month,closingDay),sameMonth=monthlyDueDate(month,dueDay);
  const next=shiftMonth(month,1);
  if(sameMonth<=closingDate && !next)throw new Error('Vencimento fora do período suportado.');
  return {closingDate,dueDate:sameMonth>closingDate?sameMonth:monthlyDueDate(next!,dueDay)};
}
/** Explicit confirmation produces exactly these monthly parts, never an extra total purchase. */
export function installmentPlan(input:z.infer<typeof cardPurchaseSchema>) {
  const data=cardPurchaseSchema.parse(input),total=moneyToCents(data.totalAmount),count=BigInt(data.count),base=total/count,remainder=total%count;
  return Array.from({length:data.count},(_,i)=>({number:i+1,month:shiftMonth(data.firstMonth,i)!,amount:centsToMoney(base+(BigInt(i)<remainder?1n:0n))}));
}
export interface InvoiceEntry {amount:string;kind:string;status:string;archivedAt?:unknown;cardEntryType?:CardEntryType}
export function invoiceTotals(entries:InvoiceEntry[],previousBalance:string,statedTotal:string|null) {
  let purchases=0n,charges=0n,credits=0n,payments=0n;
  for(const row of entries) {
    if(row.archivedAt!=null || !['recorded','settled'].includes(row.status))continue;
    const amount=moneyToCents(row.amount);
    if(row.cardEntryType==='payment')payments-=amount;
    else if(row.kind==='refund')credits+=amount;
    else if(row.kind==='expense') {if(row.cardEntryType==='interest'||row.cardEntryType==='fee')charges-=amount;else purchases-=amount;}
  }
  const computed=moneyToCents(previousBalance)+purchases+charges-credits,remaining=computed-payments;
  return {purchases:decimalCents(purchases),charges:decimalCents(charges),credits:decimalCents(credits),payments:decimalCents(payments),computed:decimalCents(computed),remaining:decimalCents(remaining),divergence:statedTotal===null?null:decimalCents(moneyToCents(statedTotal)-computed)};
}
export interface CardRecord extends CardInput {id:string;revision:string;archived:boolean}
export interface CardTransaction {id:string;categoryId:string;description:string;amount:string;kind:string;competenceMonth:string;purchaseDate:string;paidDate:string|null;revision:string;type:CardEntryType;installmentNumber:number|null;installmentCount:number|null;refundOfId:string|null;recurrenceOccurrenceId:string|null;source:string;reconciledFrom:string[]}
export interface InvoiceView {id:string;revision:string;month:string;closingDate:string;dueDate:string;statedTotal:string|null;previousBalance:string;closed:boolean;status:string;paymentAccountId:string;entries:CardTransaction[];totals:ReturnType<typeof invoiceTotals>;monthClosed:boolean}
export interface CardCandidate {id:string;description:string;amount:string;kind:string;status:string;competenceMonth:string;purchaseDate:string;revision:string;source:string;accountId:string}
export interface CardOccurrenceCandidate {id:string;description:string;amount:string;revision:string;accountId:string;categoryId:string}
