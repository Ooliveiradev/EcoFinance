import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { addCardPurchase } from '@/lib/card-purchases';
export async function POST(r:Request,c:{params:Promise<{id:string}>}){const {id}=await c.params;return financeWrite(r,(owner,key,input)=>addCardPurchase(db,owner,key,id,input),201);}
