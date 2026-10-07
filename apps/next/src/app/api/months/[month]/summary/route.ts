import { isMonthParam } from '@ecofinance/shared';
import { financeRead } from '@/lib/finance-http';
import { loadReport } from '@/lib/metrics-read';
import { FinanceError } from '@/lib/manual-finance-service';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{month:string}>}) {
  const {month}=await params;
  return financeRead(request,async owner=> {
    if(!isMonthParam(month))throw new FinanceError('INVALID_MONTH',400,'Mês inválido.');
    const {report,projection}=await loadReport(owner,{from:month,to:month,basis:'competence'});
    const row=report.months[0]!;
    return {month,income:row.income,expenses:row.expenses,balance:projection.balance,entriesCount:row.count,projection};
  });
}
