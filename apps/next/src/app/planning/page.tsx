import { db } from '@ecofinance/db';
import { resolveMonthParam, monthBounds, currentMonthParam } from '@ecofinance/shared';
import { exactCents, displayMoney, ownedReferences } from '@/lib/financial-read';
import PlanningClient from './planning-client';
import { requirePageUser } from '@/lib/session';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function PlanningPage({searchParams}: {searchParams?:Promise<{mes?:string}>}) {
  const userId=await requirePageUser();
  const params=searchParams ? await searchParams : {};
  const now=new Date();
  const resolved=resolveMonthParam(typeof params.mes==='string'?params.mes:null,now);
  const bounds=monthBounds(resolved.month)??monthBounds(currentMonthParam(now))!;
  try {
    const [occurrences,budgets,transactions]=await Promise.all([
      db.owned('recurrenceOccurrences',userId,{where:[{field:'competenceMonth',value:`${resolved.month}-01`}],order:[{field:'dueDate',direction:'asc'}]}),
      db.owned('budgets',userId,{where:[{field:'competenceMonth',value:`${resolved.month}-01`}],limit:1}),
      db.owned('transactions',userId,{where:[{field:'date',op:'gte',value:new Date(`${bounds.start}T00:00:00Z`)},{field:'date',op:'lt',value:new Date(`${bounds.endExclusive}T00:00:00Z`)}]}),
    ]);
    const budget=budgets[0];
    const [rules,limits]=await Promise.all([
      ownedReferences('recurrenceRules',userId,occurrences.map(o=>o.ruleId)),
      budget?db.owned('budgetCategories',userId,{where:[{field:'budgetId',value:budget.id}]}):Promise.resolve([]),
    ]);
    const categories=await ownedReferences('categories',userId,limits.map(l=>l.categoryId));
    const spent=transactions.reduce((sum,t)=> {const amount=exactCents(t.amount);return amount<0n?sum-amount:sum;},0n);
    return <PlanningClient month={resolved.month} isCurrentMonth={resolved.isCurrent}
      occurrences={occurrences.map(o=>({id:o.id,description:rules.get(o.ruleId)!.description,amount:Math.abs(displayMoney(exactCents(o.amount))),dueDate:o.dueDate,status:o.status as 'pending'|'paid'|'postponed'|'cancelled',dueDay:rules.get(o.ruleId)!.dueDay}))}
      budgetLimit={displayMoney(exactCents(budget?.limit??'0'))} expectedIncome={displayMoney(exactCents(budget?.expectedIncome??'0'))} reserve={displayMoney(exactCents(budget?.reserve??'0'))} totalSpent={displayMoney(spent)}
      categoryBudgets={limits.map(l=>({id:l.id,categoryName:categories.get(l.categoryId)!.name,categoryKey:categories.get(l.categoryId)!.legacyKey??categories.get(l.categoryId)!.name.toLowerCase(),limit:displayMoney(exactCents(l.limit)),spent:0}))} />;
  } catch {
    return <PlanningClient month={resolved.month} isCurrentMonth={resolved.isCurrent} error="Falha ao carregar planejamento." occurrences={[]} budgetLimit={0} expectedIncome={0} reserve={0} totalSpent={0} categoryBudgets={[]} />;
  }
}
