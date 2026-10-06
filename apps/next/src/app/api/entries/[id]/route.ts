import { db } from '@ecofinance/db';
import { archiveAction,financeWrite } from '@/lib/finance-http';
import { archiveEntry,saveEntry } from '@/lib/manual-finance-service';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeWrite(request,(owner,key,input,version)=>saveEntry(db,owner,key,input,id,version));
}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeWrite(request,(owner,key,_input,version)=>archiveEntry(db,owner,key,id,version,true));
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return financeWrite(request,(owner,key,input,version)=>archiveEntry(db,owner,key,id,version,archiveAction(input)));
}
