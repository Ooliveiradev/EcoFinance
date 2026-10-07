import { db } from '@ecofinance/db';
import { planningMonthSchema } from '@ecofinance/shared';
import { financeWrite } from '@/lib/finance-http';
import { FinanceError } from '@/lib/finance-operation';
import { generateMonth } from '@/lib/planning-rules';
import { saveBudget,closeMonth } from '@/lib/planning-budget';
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{month:string;action:string}>}) {
  const {month,action}=await params;return financeWrite(request,(owner,key,input,version)=>{
    planningMonthSchema.parse(month);
    if(action==='copy')return saveBudget(db,owner,key,month,input,version,true);
    if(action==='state')return closeMonth(db,owner,key,month,version,input);
    if(action==='generate' && input && typeof input==='object' && !Array.isArray(input) && Object.keys(input).length===0)return generateMonth(db,owner,key,month);
    throw new FinanceError('INVALID_ACTION',400,'Ação inválida.');
  });
}
