import { db } from '@ecofinance/db';
import { resolveMonthParam, monthBounds, shiftMonth, percentChange, describeTrend } from '@ecofinance/shared';
import { exactCents, displayMoney, ownedReferences } from './financial-read';
import type { DashboardClientProps } from '@/app/dashboard-client';
export async function loadDashboardData(userId: string, resolved: ReturnType<typeof resolveMonthParam>, bounds: NonNullable<ReturnType<typeof monthBounds>>): Promise<DashboardClientProps> {
  const base={month:resolved.month,isCurrentMonth:resolved.isCurrent,monthValid:resolved.valid};
  try {
    const previous=shiftMonth(resolved.month,-1);
    const prevBounds=previous ? monthBounds(previous) : null;
    const [accounts,rows,occurrences,invoices]=await Promise.all([
      db.owned('accounts',userId,{order:[{field:'name',direction:'asc'}]}),
      db.owned('transactions',userId,{where:[{field:'date',op:'gte',value:new Date(`${prevBounds?.start ?? bounds.start}T00:00:00Z`)},{field:'date',op:'lt',value:new Date(`${bounds.endExclusive}T00:00:00Z`)}],order:[{field:'date',direction:'desc'},{field:'id',direction:'desc'}]}),
      db.owned('recurrenceOccurrences',userId,{where:[{field:'competenceMonth',value:`${resolved.month}-01`}],order:[{field:'dueDate',direction:'asc'}]}),
      db.owned('invoices',userId,{where:[{field:'competenceMonth',value:`${resolved.month}-01`}]}),
    ]);
    const [rules,cards]=await Promise.all([
      ownedReferences('recurrenceRules',userId,occurrences.map(o=>o.ruleId)),
      ownedReferences('cards',userId,invoices.map(i=>i.cardId)),
    ]);
    const current=rows.filter(row=>row.date>=new Date(`${bounds.start}T00:00:00Z`));
    const last=rows.filter(row=>row.date<new Date(`${bounds.start}T00:00:00Z`));
    const totals=(data:typeof rows)=>data.reduce((t,row)=> {const amount=exactCents(row.amount); if(amount>0n)t.income+=amount;else t.expenses-=amount;return t;},{income:0n,expenses:0n});
    const cur=totals(current), prev=totals(last);
    const grouped=new Map<string,bigint>();
    for(const row of current) {const amount=exactCents(row.amount);if(amount<0n)grouped.set(row.category,(grouped.get(row.category)??0n)-amount);}
    const trend=(a:bigint,b:bigint)=>describeTrend(last.length ? percentChange(displayMoney(a),displayMoney(b)) : null);
    return {
      ...base,totalBalance:displayMoney(accounts.reduce((sum,a)=>sum+exactCents(a.balance),0n)),
      income:{value:displayMoney(cur.income),trend:trend(cur.income,prev.income)},
      expenses:{value:displayMoney(cur.expenses),trend:trend(cur.expenses,prev.expenses)},
      transactionsCount:{value:current.length,trend:describeTrend(last.length?percentChange(current.length,last.length):null)},
      categoryData:[...grouped].map(([name,value])=>({name,value:displayMoney(value),color:''})),
      recentTransactions:current.slice(0,10).map(tx=>({id:tx.id,date:tx.date.toISOString(),description:tx.description,category:tx.category,amount:tx.amount,source:tx.source})),
      upcomingBills:[
        ...occurrences.map(o=>({id:o.id,description:rules.get(o.ruleId)!.description,amount:Math.abs(displayMoney(exactCents(o.amount))),dueDate:o.dueDate,category:'Recorrente',isPaid:o.status==='paid'})),
        ...invoices.map(i=>({id:i.id,description:`Fatura ${cards.get(i.cardId)!.name}`,amount:Math.abs(displayMoney(exactCents(i.statedTotal??'0'))),dueDate:i.dueDate,category:'Cartão de crédito',isPaid:i.status==='paid'})),
      ],accounts:accounts.map(({id,name})=>({id,name})),
    };
  } catch {
    return {...base,error:'Não foi possível carregar os dados financeiros do banco de dados.',totalBalance:0,income:{value:0,trend:describeTrend(null)},expenses:{value:0,trend:describeTrend(null)},transactionsCount:{value:0,trend:describeTrend(null)},categoryData:[],recentTransactions:[],upcomingBills:[],accounts:[]};
  }
}
