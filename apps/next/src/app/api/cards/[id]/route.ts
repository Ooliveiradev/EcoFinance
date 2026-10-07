import { db } from '@ecofinance/db';
import { financeWrite,archiveAction } from '@/lib/finance-http';
import { saveCard,archiveCard } from '@/lib/card-store';
type Context={params:Promise<{id:string}>};
export async function PUT(r:Request,c:Context){const {id}=await c.params;return financeWrite(r,(owner,key,input,expected)=>saveCard(db,owner,key,input,id,expected));}
export async function PATCH(r:Request,c:Context){const {id}=await c.params;return financeWrite(r,(owner,key,input,expected)=>archiveCard(db,owner,key,id,expected,archiveAction(input)));}
