import { currentMonthParam, metricsQuerySchema, shiftMonth } from '@ecofinance/shared';
import { requirePageUser } from '@/lib/session';
import { loadReport } from '@/lib/metrics-read';
import ReportsClient from './reports-client';
export const dynamic='force-dynamic';
export const revalidate=0;
type Params={de?:string;ate?:string;base?:string};
export default async function ReportsPage({searchParams}:{searchParams?:Promise<Params>}) {
  const owner=await requirePageUser(),params=searchParams?await searchParams:{};
  const today=currentMonthParam(new Date()),fallback={from:shiftMonth(today,-5)??today,to:today,basis:'competence' as const};
  const requested=metricsQuerySchema.safeParse({from:params.de??fallback.from,to:params.ate??fallback.to,basis:params.base??fallback.basis});
  const query=requested.success?requested.data:fallback;
  const notice=requested.success?undefined:'Período inválido (até 12 meses, início antes do fim). Exibindo os últimos 6 meses.';
  try {
    return <ReportsClient query={query} data={await loadReport(owner,query)} notice={notice}/>;
  } catch {
    return <ReportsClient query={query} data={null} notice={notice} error="Não foi possível carregar os relatórios. Nenhum valor foi estimado; tente novamente."/>;
  }
}
