import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { saveRule } from '@/lib/planning-rules';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeWrite(request,(owner,key,input,version)=>saveRule(db,owner,key,input,id,version));
}
