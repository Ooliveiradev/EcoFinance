import { db } from '@ecofinance/db';
import { planningMonthSchema } from '@ecofinance/shared';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { loadPlanning } from '@/lib/planning-read';
import { saveBudget } from '@/lib/planning-budget';
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{month:string}>}) {
  const {month}=await params;return financeRead(request,owner=>loadPlanning(db,owner,month));
}
export async function PUT(request:Request,{params}:{params:Promise<{month:string}>}) {
  const {month}=await params;return financeWrite(request,(owner,key,input,version)=>saveBudget(db,owner,key,planningMonthSchema.parse(month),input,version));
}
