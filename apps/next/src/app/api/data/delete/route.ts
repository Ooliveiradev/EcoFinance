import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { deleteUserData } from '@/lib/data-control';
export const dynamic='force-dynamic';
/** Irreversible: typed confirmation and If-Match with the data revision from GET /api/data. */
export async function POST(request:Request) {
  return financeWrite(request,(owner,_key,input,expected)=>deleteUserData(db,owner,input,expected));
}
