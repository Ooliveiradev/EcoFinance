import { db } from '@ecofinance/db';
import { financeError } from '@/lib/finance-http';
import { authorize } from '@/lib/session';
import { PRIVATE_CACHE } from '@/lib/access-policy';
import { exportEntries } from '@/lib/data-control';
export const dynamic='force-dynamic';
/** GET /api/data/entries?from=YYYY-MM-DD&to=YYYY-MM-DD — entry CSV with formula neutralization. */
export async function GET(request:Request) {
  try {
    const access=await authorize(request);if(access.response)return access.response;
    const csv=await exportEntries(db,access.userId,Object.fromEntries(new URL(request.url).searchParams));
    return new Response(csv,{headers:{
      'Content-Type':'text/csv; charset=utf-8','Cache-Control':PRIVATE_CACHE,'X-Content-Type-Options':'nosniff',
      'Content-Disposition':`attachment; filename="ecofinance-lancamentos-${new Date().toISOString().slice(0,10)}.csv"`,
    }});
  } catch(error) {return financeError(error);}
}
