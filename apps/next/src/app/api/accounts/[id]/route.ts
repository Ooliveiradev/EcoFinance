import { db } from '@ecofinance/db';
import { archiveAction,financeWrite } from '@/lib/finance-http';
import { archiveReference,saveAccount } from '@/lib/manual-finance-service';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeWrite(request,(owner,key,input,version)=>saveAccount(db,owner,key,input,id,version));
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeWrite(request,(owner,key,input,version)=>archiveReference(db,owner,key,'accounts',id,version,archiveAction(input)));
}
