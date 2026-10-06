import { isMonthParam,monthBounds,resolveMonthParam } from '@ecofinance/shared';
import { financeRead } from '@/lib/finance-http';
import { loadDashboardData } from '@/lib/dashboard-data';
import { FinanceError } from '@/lib/manual-finance-service';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{month:string}>}) {
  const {month}=await params;
  return financeRead(request,async owner=> {
    if(!isMonthParam(month))throw new FinanceError('INVALID_MONTH',400,'Mês inválido.');
    const data=await loadDashboardData(owner,resolveMonthParam(month,new Date()),monthBounds(month)!);
    if(data.error)throw new FinanceError('UNAVAILABLE',503,data.error);
    return {month,income:data.income.exact,expenses:data.expenses.exact,balance:data.totalBalanceExact,entriesCount:data.transactionsCount.value};
  });
}
