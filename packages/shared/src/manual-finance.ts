import { z } from 'zod';
import { moneySchema, moneyToCents, civilDateSchema, competenceSchema } from './finance';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const sortOrder = z.number().int().min(0).max(100000);
export const manualAccountSchema = z.object({
  name:z.string().trim().min(1).max(120), type:z.enum(['banco','carteira']),
  openingBalance:moneySchema, openingDate:civilDateSchema,
  color:color.default('#64748b'), sortOrder:sortOrder.default(0),
}).strict();
export const manualCategorySchema = z.object({
  name:z.string().trim().min(1).max(120), color, icon:z.string().min(1).max(60).default('tag'),
  sortOrder:sortOrder.default(0),
}).strict();
export const manualEntrySchema = z.object({
  accountId:z.string().uuid(), categoryId:z.string().uuid(),
  toAccountId:z.string().uuid().nullable().default(null),
  description:z.string().trim().min(1).max(500), amount:moneySchema,
  kind:z.enum(['income','expense','transfer']), status:z.enum(['planned','recorded','settled','cancelled']),
  purchaseDate:civilDateSchema, competenceMonth:competenceSchema,
  dueDate:civilDateSchema.nullable(), paidDate:civilDateSchema.nullable(),
  notes:z.string().max(2000).nullable().default(null),
}).strict().superRefine((entry,context)=> {
  const parsed=moneySchema.safeParse(entry.amount);
  if (parsed.success && moneyToCents(parsed.data)<=0n) context.addIssue({code:'custom',path:['amount'],message:'Informe um valor maior que zero.'});
  if (entry.kind==='transfer' && (!entry.toAccountId || entry.toAccountId===entry.accountId)) context.addIssue({code:'custom',path:['toAccountId'],message:'Escolha outra conta própria para receber a transferência.'});
  if (entry.kind!=='transfer' && entry.toAccountId!==null) context.addIssue({code:'custom',path:['toAccountId'],message:'Destino pertence apenas a transferências.'});
  if (entry.status==='settled' && !entry.paidDate) context.addIssue({code:'custom',path:['paidDate'],message:'Informe a data de pagamento.'});
});
export const manualListSchema = z.object({
  id:z.string().uuid().optional(), accountId:z.string().uuid().optional(), categoryId:z.string().uuid().optional(),
  kind:z.enum(['income','expense','transfer','refund','adjustment','unclassified']).optional(),
  status:z.enum(['planned','recorded','settled','cancelled']).optional(),
  startDate:civilDateSchema.optional(), endDate:civilDateSchema.optional(),
  competenceMonth:competenceSchema.optional(),
  description:z.string().max(120).optional(), archived:z.enum(['true','false']).default('false'),
  page:z.coerce.number().int().min(1).max(1000).default(1), limit:z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(q=>!q.startDate || !q.endDate || q.startDate<=q.endDate,'Intervalo inválido.');
export type ManualAccount = z.infer<typeof manualAccountSchema>;
export type ManualCategory = z.infer<typeof manualCategorySchema>;
export type ManualEntry = z.infer<typeof manualEntrySchema>;
export type ManualList = z.infer<typeof manualListSchema>;
export interface ManualAccountRecord extends Omit<ManualAccount,'openingDate'> {id:string; openingDate:string|null; currency:string; archivedAt:string|null; revision:string; balance:string|null}
export interface ManualCategoryRecord extends ManualCategory {id:string; archivedAt:string|null; revision:string}
export interface ManualEntryRecord extends Omit<ManualEntry,'kind'> {id:string; kind:string; source:string; archivedAt:string|null; transferId:string|null; revision:string; accountName:string; categoryName:string; categoryColor:string; transferFromAccountId:string|null}

export interface BalanceAccount { id:string; openingBalance:string; openingDate:string|null; archivedAt?:unknown }
export interface SummaryEntry { accountId:string; amount:string; kind:string; status:string; competenceMonth:string; paidDate:string|null; archivedAt?:unknown }
export function accountBalances(accounts:BalanceAccount[], entries:SummaryEntry[], asOf:string):Map<string,bigint|null> {
  civilDateSchema.parse(asOf);
  const result=new Map(accounts.map(a=>[a.id,a.openingDate && a.openingDate<=asOf?moneyToCents(a.openingBalance):null]));
  const dates=new Map(accounts.map(a=>[a.id,a.openingDate]));
  for(const entry of entries) {
    const opening=dates.get(entry.accountId), current=result.get(entry.accountId);
    if(entry.archivedAt==null && entry.status==='settled' && entry.paidDate && opening && entry.paidDate>=opening && entry.paidDate<=asOf && current!=null) result.set(entry.accountId,current+moneyToCents(entry.amount));
  }
  return result;
}
export function monthTotals(entries:SummaryEntry[], month:string) {
  competenceSchema.parse(month+'-01');
  let income=0n, expenses=0n;
  for(const entry of entries) {
    if(entry.archivedAt!=null || entry.competenceMonth!==month+'-01' || !['recorded','settled'].includes(entry.status))continue;
    const amount=moneyToCents(entry.amount);
    if(entry.kind==='income')income+=amount;
    if(entry.kind==='expense' || entry.kind==='refund')expenses-=amount;
  }
  return {income,expenses};
}
const currencyFormatter=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
/** Aggregated balances can exceed the input limit of one financial entry. */
export function decimalCents(cents:bigint):string {
  const absolute=cents<0n?-cents:cents;
  return `${cents<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`;
}
/** Formats integer cents without rounding through binary floating point. */
export function formatCents(cents:bigint):string {
  const negative=cents<0n, absolute=negative?-cents:cents, whole=absolute/100n;
  return currencyFormatter.formatToParts(negative?-(whole||1n):whole).map(part=> {
    if(part.type==='fraction')return String(absolute%100n).padStart(2,'0');
    if(part.type==='integer' && whole===0n)return '0';
    return part.value;
  }).join('');
}
