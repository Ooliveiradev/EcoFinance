import { db } from '@ecofinance/db';
import { resolveMonthParam, monthBounds, shiftMonth, percentChange, describeTrend, accountBalances,monthTotals,civilToday,formatCents,decimalCents,invoiceTotals } from '@ecofinance/shared';
import { exactCents, displayMoney, ownedReferences } from './financial-read';
import type { DashboardClientProps } from '@/app/dashboard-client';
export async function loadDashboardData(userId:string,resolved:ReturnType<typeof resolveMonthParam>,bounds:NonNullable<ReturnType<typeof monthBounds>>):Promise<DashboardClientProps> {
  const base={month:resolved.month,isCurrentMonth:resolved.isCurrent,monthValid:resolved.valid};
  try {
    const [accounts,rows,categories,occurrences,invoices]=await Promise.all([
      db.owned('accounts',userId,{order:[{field:'name',direction:'asc'}]}),
      db.owned('transactions',userId),
      db.owned('categories',userId,{order:[{field:'sortOrder',direction:'asc'},{field:'name',direction:'asc'}]}),
      db.owned('recurrenceOccurrences',userId,{where:[{field:'competenceMonth',value:resolved.month+'-01'}],order:[{field:'dueDate',direction:'asc'}]}),
      db.owned('invoices',userId,{where:[{field:'competenceMonth',value:resolved.month+'-01'}]}),
    ]);
    const [rules,cards]=await Promise.all([ownedReferences('recurrenceRules',userId,occurrences.map(o=>o.ruleId)),ownedReferences('cards',userId,invoices.map(i=>i.cardId))]);
    const previous=shiftMonth(resolved.month,-1)!;
    const current=rows.filter(row=>row.archivedAt===null && row.competenceMonth===resolved.month+'-01');
    const last=rows.filter(row=>row.archivedAt===null && row.competenceMonth===previous+'-01');
    const cur=monthTotals(current,resolved.month),prev=monthTotals(last,previous);
    const categoryMap=new Map(categories.map(c=>[c.id,c])),grouped=new Map<string,bigint>();
    for(const row of current) {
      if(!['recorded','settled'].includes(row.status) || !['expense','refund'].includes(row.kind))continue;
      grouped.set(row.categoryId,(grouped.get(row.categoryId)??0n)-exactCents(row.amount));
    }
    // Number is used only for chart geometry/trend percentages. Money labels and
    // every financial total retain the original integer-cent result.
    const chart=(cents:bigint)=>Number(cents)/100;
    const trend=(a:bigint,b:bigint)=>describeTrend(last.length?percentChange(chart(a),chart(b)):null);
    const today=civilToday(new Date()),monthEnd=new Date(new Date(bounds.endExclusive+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
    const balances=accountBalances(accounts,rows,today<monthEnd?today:monthEnd),active=accounts.filter(a=>!a.archivedAt);
    const incomplete=active.some(a=>balances.get(a.id)==null);
    const balance=active.reduce((sum,a)=>sum+(balances.get(a.id)??0n),0n);
    return {
      ...base,totalBalance:chart(balance),totalBalanceFormatted:incomplete?'Saldo incompleto':formatCents(balance),totalBalanceExact:incomplete?null:decimalCents(balance),
      income:{value:chart(cur.income),formatted:formatCents(cur.income),exact:decimalCents(cur.income),trend:trend(cur.income,prev.income)},
      expenses:{value:chart(cur.expenses),formatted:formatCents(cur.expenses),exact:decimalCents(cur.expenses),trend:trend(cur.expenses,prev.expenses)},
      transactionsCount:{value:current.length,trend:describeTrend(last.length?percentChange(current.length,last.length):null)},
      categoryData:[...grouped].map(([id,value])=>({id,name:categoryMap.get(id)?.name??'Categoria histórica',value:chart(value),formatted:formatCents(value),color:categoryMap.get(id)?.color??'#64748b'})),
      recentTransactions:current.toSorted((a,b)=>b.purchaseDate.localeCompare(a.purchaseDate)||b.id.localeCompare(a.id)).slice(0,10).map(tx=>({id:tx.id,date:tx.purchaseDate,description:tx.description,category:tx.category,categoryName:categoryMap.get(tx.categoryId)?.name,amount:tx.amount,source:tx.source})),
      upcomingBills:[
        ...occurrences.filter(o=>o.status!=='cancelled').map(o=>({id:o.id,description:o.snapshot?.description??rules.get(o.ruleId)!.description,amount:Math.abs(displayMoney(exactCents(o.amount))),dueDate:o.dueDate,category:'Recorrente',isPaid:o.status==='paid'})),
        ...invoices.map(i=>{const totals=invoiceTotals(rows.filter(r=>r.invoiceId===i.id),i.previousBalance??'0.00',i.statedTotal);const balance=BigInt(totals.remaining.replace('.',''));return {id:i.id,description:'Fatura '+cards.get(i.cardId)!.name,amount:displayMoney(balance>0n?balance:0n),dueDate:i.dueDate,category:'Cartão de crédito',isPaid:i.status==='paid'};}),
      ],
      accounts:active.map(({id,name})=>({id,name})),categories:categories.filter(c=>!c.archivedAt).map(({id,name})=>({id,name})),
    };
  } catch {
    return {...base,error:'Não foi possível carregar os dados financeiros do banco de dados.',totalBalance:0,income:{value:0,trend:describeTrend(null)},expenses:{value:0,trend:describeTrend(null)},transactionsCount:{value:0,trend:describeTrend(null)},categoryData:[],recentTransactions:[],upcomingBills:[],accounts:[],categories:[]};
  }
}
