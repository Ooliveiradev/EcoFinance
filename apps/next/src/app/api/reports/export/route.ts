import { metricsCsv } from '@ecofinance/shared';
import { financeError } from '@/lib/finance-http';
import { authorize } from '@/lib/session';
import { PRIVATE_CACHE } from '@/lib/access-policy';
import { loadReport } from '@/lib/metrics-read';
export const dynamic='force-dynamic';
/** CSV with exactly the values of GET /api/reports for the same filter. */
export async function GET(request:Request) {
  try {
    const access=await authorize(request);if(access.response)return access.response;
    const {report}=await loadReport(access.userId,Object.fromEntries(new URL(request.url).searchParams));
    return new Response(metricsCsv(report),{headers:{
      'Content-Type':'text/csv; charset=utf-8','Cache-Control':PRIVATE_CACHE,'X-Content-Type-Options':'nosniff',
      'Content-Disposition':`attachment; filename="ecofinance-${report.basis}-${report.from}-${report.to}.csv"`,
    }});
  } catch(error) {return financeError(error);}
}
