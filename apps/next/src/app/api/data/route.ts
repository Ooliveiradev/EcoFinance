import { db } from '@ecofinance/db';
import { financeRead } from '@/lib/finance-http';
import { dataSummary } from '@/lib/data-control';
export const dynamic='force-dynamic';
/** GET /api/data — counts, data revision (If-Match for restore/delete) and retained import originals. */
export async function GET(request:Request) {
  return financeRead(request,owner=>dataSummary(db,owner));
}
