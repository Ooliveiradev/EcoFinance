import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { saveRule } from '@/lib/planning-rules';
export const dynamic='force-dynamic';
export async function POST(request:Request) {return financeWrite(request,(owner,key,input)=>saveRule(db,owner,key,input),201);}
