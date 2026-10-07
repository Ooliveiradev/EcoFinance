import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { FinanceError } from '@/lib/finance-operation';
import { changeOccurrence,payOccurrence } from '@/lib/planning-occurrences';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{id:string;action:string}>}) {
  const {id,action}=await params;return financeWrite(request,(owner,key,input,version)=>{
    if(action==='pay'||action==='reconcile')return payOccurrence(db,owner,key,id,version,input,action==='reconcile');
    if(action==='edit'||action==='postpone'||action==='cancel'||action==='restore')return changeOccurrence(db,owner,key,id,version,action,input);
    throw new FinanceError('INVALID_ACTION',400,'Ação inválida.');
  });
}
