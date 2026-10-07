import { db, type Database } from '@ecofinance/db';
import { accountBalances,centsToMoney,civilToday,invoiceTotals,metricsQuerySchema,metricsReport,monthBounds,monthProjection,monthsBetween,moneyToCents,shiftMonth,type BudgetPlan,type MetricsInput,type MetricsQuery,type PlanningOccurrence } from '@ecofinance/shared';
import { budgetData } from './planning-budget';
import { occurrenceSnapshot } from './planning-rules';
import { FinanceError } from './finance-operation';

/**
 * Reads one consistent snapshot of the owner's financial data. Aggregates are not
 * persisted: every read recomputes them, so manual CRUD, reconciliation, card
 * operations and committed/reverted imports are reflected on the next request.
 * Import previews live in import items, never in transactions, so they cannot
 * leak into confirmed numbers. Failures and the 10k-row read limit propagate as
 * errors instead of becoming zero totals.
 */
export async function readMetricsData(ownerId:string,months:string[],store:Database=db) {
  const competences=months.map(month=>month+'-01');
  return store.transaction(async tx=>{
    const [accounts,rows,categories,occurrences,rules,budgets,invoices,cards]=await Promise.all([
      tx.owned('accounts',ownerId,{order:[{field:'name',direction:'asc'}]}),
      tx.owned('transactions',ownerId),
      tx.owned('categories',ownerId,{order:[{field:'sortOrder',direction:'asc'},{field:'name',direction:'asc'}]}),
      tx.owned('recurrenceOccurrences',ownerId,{where:[{field:'competenceMonth',op:'in',value:competences}],order:[{field:'dueDate',direction:'asc'},{field:'id',direction:'asc'}]}),
      tx.owned('recurrenceRules',ownerId),
      tx.owned('budgets',ownerId,{where:[{field:'competenceMonth',op:'in',value:competences}]}),
      tx.owned('invoices',ownerId,{where:[{field:'competenceMonth',op:'in',value:competences}]}),
      tx.owned('cards',ownerId),
    ]);
    const plans=new Map<string,BudgetPlan>(await Promise.all(budgets.map(async budget=>[budget.competenceMonth.slice(0,7),await budgetData(tx,ownerId,budget)] as const)));
    const ruleMap=new Map(rules.map(rule=>[rule.id,rule]));
    const projected=occurrences.map(row=>{
      const rule=ruleMap.get(row.ruleId);
      if(!rule)throw new Error('Occurrence without owned rule.');
      const snapshot=occurrenceSnapshot(row,rule),cents=moneyToCents(row.amount);
      return {...row,status:row.status as PlanningOccurrence['status'],description:snapshot.description,categoryId:snapshot.categoryId,amount:centsToMoney(cents<0n?-cents:cents)};
    });
    const invoiceRows=invoices.map(invoice=>({...invoice,totals:invoiceTotals(rows.filter(row=>row.invoiceId===invoice.id),invoice.previousBalance??'0.00',invoice.statedTotal)}));
    const input:MetricsInput={
      entries:rows,occurrences:projected,plans,
      categories:categories.map(({id,name,color})=>({id,name,color})),
      invoices:invoiceRows.map(invoice=>({competenceMonth:invoice.competenceMonth,remaining:invoice.totals.remaining,paid:invoice.status==='paid'})),
    };
    return {accounts,rows,categories,occurrences:projected,invoices:invoiceRows,cards:new Map(cards.map(card=>[card.id,card])),input};
  });
}
export type MetricsData=Awaited<ReturnType<typeof readMetricsData>>;

/** Consolidated balance on the last civil day already elapsed in `month`; null when any active account has no usable opening. */
export function consolidatedBalance(data:Pick<MetricsData,'accounts'|'rows'>,month:string,now:Date):bigint|null {
  const bounds=monthBounds(month);
  if(!bounds)throw new FinanceError('INVALID_MONTH',400,'Mês inválido.');
  const today=civilToday(now),monthEnd=new Date(new Date(bounds.endExclusive+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const balances=accountBalances(data.accounts,data.rows,today<monthEnd?today:monthEnd),active=data.accounts.filter(account=>!account.archivedAt);
  if(active.some(account=>balances.get(account.id)==null))return null;
  return active.reduce((sum,account)=>sum+(balances.get(account.id)??0n),0n);
}

/** Report for the reports page, its export and the mobile API: one snapshot, one calculation. */
export async function loadReport(ownerId:string,query:unknown,now=new Date(),store:Database=db) {
  const parsed:MetricsQuery=metricsQuerySchema.parse(query);
  const before=shiftMonth(parsed.from,-1),months=monthsBetween(parsed.from,parsed.to);
  const data=await readMetricsData(ownerId,before?[before,...months]:months,store);
  return {report:metricsReport(data.input,parsed),projection:monthProjection(data.input,parsed.to,consolidatedBalance(data,parsed.to,now))};
}
