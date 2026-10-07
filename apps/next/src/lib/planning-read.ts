import type { Database } from '@ecofinance/db';
import { moneyToCents,centsToMoney,scheduleForMonth,planningMonthSchema,planningSummary,type PlanningView,type PlanningOccurrence } from '@ecofinance/shared';
import { revision,owned } from './finance-operation';
import { monthState } from './planning-lock';
import { monthBudget,budgetData } from './planning-budget';
import { ruleVersions,occurrenceSnapshot,legacySchedule } from './planning-rules';
export async function loadPlanning(db:Database,ownerId:string,month:string):Promise<PlanningView> {
  planningMonthSchema.parse(month);
  return db.transaction(async tx=>{
    const [state,rules,occurrences,budget,entries]=await Promise.all([
      monthState(tx,ownerId,month),tx.owned('recurrenceRules',ownerId),tx.owned('recurrenceOccurrences',ownerId,{where:[{field:'competenceMonth',value:month+'-01'}],order:[{field:'dueDate',direction:'asc'},{field:'id',direction:'asc'}]}),monthBudget(tx,ownerId,month),tx.owned('transactions',ownerId,{where:[{field:'competenceMonth',value:month+'-01'}]})]);
    const plan=budget?{...await budgetData(tx,ownerId,budget),id:budget.id,revision:revision(budget)}:null;
    const projected=await Promise.all(occurrences.map(async o=>{
      const rule=rules.find(r=>r.id===o.ruleId)??await owned(tx,'recurrenceRules',o.ruleId,ownerId),snapshot=occurrenceSnapshot(o,rule);
      return {id:o.id,ruleId:o.ruleId,competenceMonth:o.competenceMonth,dueDate:o.dueDate,amount:centsToMoney(moneyToCents(o.amount)<0n?-moneyToCents(o.amount):moneyToCents(o.amount)),status:o.status as PlanningOccurrence['status'],description:snapshot.description,accountId:snapshot.accountId,categoryId:snapshot.categoryId,estimated:snapshot.estimated,reminderDays:snapshot.reminderDays,revision:revision(o),overridden:o.overridden??false,transactionId:o.transactionId??null};
    }));
    return {month,closed:!!state.closedAt,monthRevision:state.revision,rules:rules.map(r=>({id:r.id,revision:revision(r),...scheduleForMonth(ruleVersions(r),month)??legacySchedule(r),fromMonth:month})),occurrences:projected,plan,...planningSummary(entries,projected,month,plan??{limit:'0.00',expectedIncome:'0.00',reserve:'0.00',categories:[]})};
  });
}
export async function reconciliationCandidates(db:Database,ownerId:string,occurrenceId:string) {
  const row=await owned(db,'recurrenceOccurrences',occurrenceId,ownerId),rule=await owned(db,'recurrenceRules',row.ruleId,ownerId),snapshot=occurrenceSnapshot(row,rule);
  const entries=await db.owned('transactions',ownerId,{where:[{field:'competenceMonth',value:row.competenceMonth},{field:'accountId',value:snapshot.accountId},{field:'kind',value:'expense'},{field:'archivedAt',value:null},{field:'source',op:'ne',value:'manual'},{field:'status',op:'in',value:['recorded','settled']},{field:'recurrenceOccurrenceId',value:null},{field:'invoiceId',value:null},{field:'installmentId',value:null}],order:[{field:'purchaseDate',direction:'desc'},{field:'id',direction:'asc'}],limit:101});
  return {entries:entries.filter(e=>e.source!=='manual'&&['recorded','settled'].includes(e.status)&&!e.recurrenceOccurrenceId&&!e.invoiceId&&!e.installmentId&&!e.transferId).slice(0,100).map(e=>({id:e.id,description:e.description,amount:e.amount,source:e.source,paidDate:e.paidDate,revision:revision(e)})),hasMore:entries.length>100};
}
