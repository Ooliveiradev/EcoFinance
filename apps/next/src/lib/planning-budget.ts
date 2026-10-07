import { randomUUID } from 'node:crypto';
import type { Database,Models } from '@ecofinance/db';
import { budgetPlanSchema,copyPlanSchema,planningMonthSchema,type BudgetPlan } from '@ecofinance/shared';
import { operation,owned,revision,checkRevision,fail } from './finance-operation';
import { monthState,assertMonthOpen,stableId,touchMonth } from './planning-lock';
export async function monthBudget(tx:Database,ownerId:string,month:string) {
  return (await tx.owned('budgets',ownerId,{where:[{field:'competenceMonth',value:month+'-01'}],limit:1}))[0]??null;
}
export async function budgetData(tx:Database,ownerId:string,budget:Models['budgets']):Promise<BudgetPlan> {
  const categories=await tx.owned('budgetCategories',ownerId,{where:[{field:'budgetId',value:budget.id}]});
  return {limit:budget.limit,expectedIncome:budget.expectedIncome,reserve:budget.reserve,categories:categories.filter(c=>!c.inactive).map(c=>({categoryId:c.categoryId,limit:c.limit}))};
}
export async function copyPreview(db:Database,ownerId:string,sourceMonth:string) {
  planningMonthSchema.parse(sourceMonth);
  return db.transaction(async tx=>{
    const budget=await monthBudget(tx,ownerId,sourceMonth);
    if(!budget)fail('NOT_FOUND',404,'O mês escolhido não tem orçamento para copiar.');
    return {sourceMonth,sourceRevision:revision(budget!),plan:await budgetData(tx,ownerId,budget!)};
  });
}
export async function saveBudget(db:Database,ownerId:string,requestId:string,month:string,input:unknown,expected:string,copy=false) {
  const parsed=copy?copyPlanSchema.parse(input):budgetPlanSchema.parse(input),plan='plan' in parsed?parsed.plan:parsed;
  return operation(db,ownerId,requestId,copy?'copy-budget':'save-budget',{month,parsed,expected},async tx=>{
    await assertMonthOpen(tx,ownerId,month);
    const old=await monthBudget(tx,ownerId,month);
    if(old)checkRevision(old,expected);else if(expected&&expected!=='new')fail('REVISION_CONFLICT',409,'O orçamento mudou. Recarregue.');
    if('sourceMonth' in parsed) {
      if(parsed.sourceMonth===month)fail('INVALID_INPUT',400,'Escolha outro mês como origem.');
      const source=await monthBudget(tx,ownerId,parsed.sourceMonth);
      if(!source)fail('NOT_FOUND',404,'Orçamento de origem não encontrado.');
      checkRevision(source!,parsed.sourceRevision);
    }
    const previous=old?await tx.owned('budgetCategories',ownerId,{where:[{field:'budgetId',value:old.id}]}):[];
    if(previous.length>100)fail('PLAN_TOO_LARGE',409,'Limite de categorias históricas deste plano atingido.');
    const categories=await Promise.all(plan.categories.map(c=>owned(tx,'categories',c.categoryId,ownerId)));
    for(const category of categories) {
      if(category.archivedAt&&!previous.some(p=>p.categoryId===category.id&&!p.inactive))fail('ARCHIVED_REFERENCE',409,'Escolha categorias ativas para novos limites.');
    }
    const now=new Date(),budget={id:old?.id??stableId(['budget',ownerId,month]),ownerId,competenceMonth:month+'-01',limit:plan.limit,expectedIncome:plan.expectedIncome,reserve:plan.reserve,currency:'BRL',revision:randomUUID(),createdAt:old?.createdAt??now,updatedAt:now};
    const limits=previous.map(c=>({...c,inactive:!plan.categories.some(p=>p.categoryId===c.categoryId),limit:plan.categories.find(p=>p.categoryId===c.categoryId)?.limit??c.limit}));
    for(const c of plan.categories.filter(c=>!previous.some(p=>p.categoryId===c.categoryId)))limits.push({id:stableId(['budget-category',ownerId,budget.id,c.categoryId]),ownerId,budgetId:budget.id,categoryId:c.categoryId,limit:c.limit,inactive:false});
    await tx.put('budgets',budget,!old);await tx.putMany('budgetCategories',limits);await touchMonth(tx,ownerId,month);
    return {id:budget.id,revision:budget.revision};
  });
}
export async function closeMonth(db:Database,ownerId:string,requestId:string,month:string,expected:string,input:unknown) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==1 || !['close','reopen'].includes(String((input as {action?:unknown}).action)))fail('INVALID_INPUT',400,'Ação inválida.');
  const action=(input as {action:string}).action;
  return operation(db,ownerId,requestId,'month-'+action,{month,expected},async tx=>{
    const state=await monthState(tx,ownerId,month);checkRevision(state,expected);
    const row={...state,closedAt:action==='close'?new Date():null,updatedAt:new Date(),revision:randomUUID()};
    await tx.put('planningMonths',row);return {id:month,revision:row.revision};
  });
}
