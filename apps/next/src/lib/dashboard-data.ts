import { resolveMonthParam, shiftMonth, percentChange, describeTrend, metricsReport, monthProjection, formatCents, decimalCents, moneyToCents } from '@ecofinance/shared';
import { displayMoney } from './financial-read';
import { readMetricsData, consolidatedBalance } from './metrics-read';
import type { DashboardClientProps } from '@/app/dashboard-client';
export async function loadDashboardData(userId:string,resolved:ReturnType<typeof resolveMonthParam>,now=new Date()):Promise<DashboardClientProps> {
  const base={month:resolved.month,isCurrentMonth:resolved.isCurrent,monthValid:resolved.valid};
  try {
    const previous=shiftMonth(resolved.month,-1);
    const data=await readMetricsData(userId,previous?[previous,resolved.month]:[resolved.month]);
    // The cards, the category chart/table and /reports share metricsReport, so
    // the same month always shows the same exact totals.
    const report=metricsReport(data.input,{from:previous??resolved.month,to:resolved.month,basis:'competence'});
    const current=report.months[report.months.length-1]!,last=previous?report.months[0]!:null;
    const balance=consolidatedBalance(data,resolved.month,now);
    const money=(value:string)=>({value:displayMoney(moneyToCents(value)),formatted:formatCents(moneyToCents(value)),exact:value});
    const monthCategories=metricsReport(data.input,{from:resolved.month,to:resolved.month,basis:'competence'}).categories;
    const categoryMap=new Map(data.categories.map(c=>[c.id,c]));
    const currentRows=data.rows.filter(row=>row.archivedAt===null && row.competenceMonth===resolved.month+'-01');
    return {
      ...base,totalBalance:balance===null?0:displayMoney(balance),totalBalanceFormatted:balance===null?'Saldo incompleto':formatCents(balance),totalBalanceExact:balance===null?null:decimalCents(balance),
      income:{...money(current.income),trend:current.trend.income},
      expenses:{...money(current.expenses),trend:current.trend.expenses},
      transactionsCount:{value:current.count,trend:describeTrend(last && last.count?percentChange(current.count,last.count):null)},
      categoryData:monthCategories.map(c=>({id:c.id,name:c.name,value:displayMoney(moneyToCents(c.amount)),formatted:formatCents(moneyToCents(c.amount)),color:c.color})),
      projection:monthProjection(data.input,resolved.month,balance),
      recentTransactions:currentRows.toSorted((a,b)=>b.purchaseDate.localeCompare(a.purchaseDate)||b.id.localeCompare(a.id)).slice(0,10).map(tx=>({id:tx.id,date:tx.purchaseDate,description:tx.description,category:tx.category,categoryName:categoryMap.get(tx.categoryId)?.name,amount:tx.amount,source:tx.source})),
      upcomingBills:[
        ...data.occurrences.filter(o=>o.competenceMonth===resolved.month+'-01' && o.status!=='cancelled').map(o=>({id:o.id,description:o.description,amount:displayMoney(moneyToCents(o.amount)),dueDate:o.dueDate,category:'Recorrente',isPaid:o.status==='paid'})),
        ...data.invoices.filter(i=>i.competenceMonth===resolved.month+'-01').map(i=>{const remaining=moneyToCents(i.totals.remaining);return {id:i.id,description:'Fatura '+data.cards.get(i.cardId)!.name,amount:displayMoney(remaining>0n?remaining:0n),dueDate:i.dueDate,category:'Cartão de crédito',isPaid:i.status==='paid'};}),
      ],
      accounts:data.accounts.filter(a=>!a.archivedAt).map(({id,name})=>({id,name})),categories:data.categories.filter(c=>!c.archivedAt).map(({id,name})=>({id,name})),
    };
  } catch {
    // No numeric fallback: the page renders the failure instead of zero totals.
    return {...base,error:'Não foi possível carregar os dados financeiros do banco de dados.'};
  }
}
