import { db } from '@ecofinance/db';
import { financeRead } from '@/lib/finance-http';
import { reconciliationCandidates } from '@/lib/planning-read';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeRead(request,owner=>reconciliationCandidates(db,owner,id));
}
