import { z } from 'zod';
import { civilDateSchema, moneySchema, moneyToCents } from './finance';
import { isMonthParam } from './month';
import { decimalCents, monthTotals, type SummaryEntry } from './manual-finance';

export const planningMonthSchema=z.string().refine(isMonthParam,'Escolha um mês entre 2000 e 2100.');
const positive=moneySchema.refine(value=>moneyToCents(value)>0n,'Informe um valor maior que zero.');
const nonnegative=moneySchema.refine(value=>moneyToCents(value)>=0n,'Informe um valor não negativo.');
export const scheduleSchema=z.object({
  accountId:z.string().uuid(),categoryId:z.string().uuid(),description:z.string().trim().min(1).max(500),
  amount:positive,startDate:civilDateSchema,endDate:civilDateSchema.nullable(),
  dueDay:z.number().int().min(1).max(31),estimated:z.boolean(),
  reminderDays:z.number().int().min(0).max(30).nullable(),paused:z.boolean(),
}).strict().refine(row=>!row.endDate || row.endDate>=row.startDate,'Fim anterior ao início.');
export const ruleChangeSchema=z.object({fromMonth:planningMonthSchema,schedule:scheduleSchema}).strict();
export const occurrenceEditSchema=z.object({description:z.string().trim().min(1).max(500),amount:positive,dueDate:civilDateSchema}).strict();
export const paymentSchema=z.object({amount:positive,paidDate:civilDateSchema}).strict();
export const reconciliationSchema=z.object({transactionId:z.string().uuid(),transactionRevision:z.string().min(1).max(100),paidDate:civilDateSchema}).strict();
export const postponementSchema=z.object({dueDate:civilDateSchema}).strict();
export const budgetPlanSchema=z.object({limit:nonnegative,expectedIncome:nonnegative,reserve:nonnegative,
  categories:z.array(z.object({categoryId:z.string().uuid(),limit:nonnegative}).strict()).max(50),
}).strict().refine(row=>new Set(row.categories.map(c=>c.categoryId)).size===row.categories.length,'Categoria repetida.');
export const copyPlanSchema=z.object({sourceMonth:planningMonthSchema,sourceRevision:z.string().min(1).max(100),plan:budgetPlanSchema}).strict();
export type RecurrenceSchedule=z.infer<typeof scheduleSchema>;
export interface ScheduleVersion {fromMonth:string;schedule:RecurrenceSchedule}
export interface PlanningRule extends RecurrenceSchedule {id:string;revision:string;fromMonth:string}
export interface PlanningOccurrence {id:string;ruleId:string;competenceMonth:string;dueDate:string;amount:string;status:'pending'|'paid'|'postponed'|'cancelled';description:string;accountId:string;categoryId:string;estimated:boolean;reminderDays:number|null;revision:string;overridden:boolean;transactionId:string|null;invoiceId?:string|null}
export type BudgetPlan=z.infer<typeof budgetPlanSchema>;
export interface PlanningView {
  month:string;closed:boolean;monthRevision:string;rules:PlanningRule[];occurrences:PlanningOccurrence[];
  plan:(BudgetPlan & {id:string;revision:string})|null;
  summary:{realized:string;pending:string;committed:string;remaining:string;deficit:string;afterReserve:string;income:string};
  categoryTotals:{categoryId:string;realized:string;pending:string;committed:string;remaining:string}[];
}
/** Day 31 becomes February 28/29; no UTC conversion of a user civil date. */
export function monthlyDueDate(month:string,day:number):string {
  planningMonthSchema.parse(month);z.number().int().min(1).max(31).parse(day);
  const [year,m]=month.split('-').map(Number) as [number,number];
  const last=new Date(Date.UTC(year,m,0)).getUTCDate();
  return month+'-'+String(Math.min(day,last)).padStart(2,'0');
}
export function scheduleForMonth(versions:ScheduleVersion[],month:string):RecurrenceSchedule|null {
  return versions.filter(v=>v.fromMonth<=month).sort((a,b)=>b.fromMonth.localeCompare(a.fromMonth))[0]?.schedule??null;
}
export function scheduledDueDate(schedule:RecurrenceSchedule,month:string):string|null {
  const due=monthlyDueDate(month,schedule.dueDay);
  return schedule.paused || due<schedule.startDate || schedule.endDate && due>schedule.endDate?null:due;
}
export function planningSummary(entries:(SummaryEntry & {categoryId:string})[],occurrences:Pick<PlanningOccurrence,'amount'|'status'|'categoryId'>[],month:string,plan:BudgetPlan) {
  const {income,expenses:realized}=monthTotals(entries,month);
  const pending=occurrences.filter(o=>o.status==='pending'||o.status==='postponed').reduce((sum,o)=>sum+moneyToCents(o.amount),0n);
  const committed=realized+pending,afterReserve=moneyToCents(plan.expectedIncome)-committed-moneyToCents(plan.reserve);
  const summary={income,realized,pending,committed,remaining:moneyToCents(plan.limit)-committed,afterReserve,deficit:afterReserve<0n?-afterReserve:0n};
  return {summary:Object.fromEntries(Object.entries(summary).map(([k,v])=>[k,decimalCents(v)])) as PlanningView['summary'],
    categoryTotals:plan.categories.map(c=>{
      const spent=monthTotals(entries.filter(e=>e.categoryId===c.categoryId),month).expenses;
      const forecast=occurrences.filter(o=>o.categoryId===c.categoryId&&(o.status==='pending'||o.status==='postponed')).reduce((sum,o)=>sum+moneyToCents(o.amount),0n);
      return {categoryId:c.categoryId,realized:decimalCents(spent),pending:decimalCents(forecast),committed:decimalCents(spent+forecast),remaining:decimalCents(moneyToCents(c.limit)-spent-forecast)};
    })};
}
