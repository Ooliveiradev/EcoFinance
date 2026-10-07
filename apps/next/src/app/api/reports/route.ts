import { financeRead } from '@/lib/finance-http';
import { loadReport } from '@/lib/metrics-read';
export const dynamic='force-dynamic';
/** GET /api/reports?from=YYYY-MM&to=YYYY-MM&basis=competence|cash — shared by web and mobile. */
export async function GET(request:Request) {
  return financeRead(request,owner=>loadReport(owner,Object.fromEntries(new URL(request.url).searchParams)));
}
