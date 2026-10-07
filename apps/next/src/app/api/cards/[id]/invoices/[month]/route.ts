import { db } from '@ecofinance/db';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { loadInvoice } from '@/lib/card-read';
import { saveInvoice } from '@/lib/card-purchases';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string;month:string}>};
export async function GET(r:Request,c:Context){const {id,month}=await c.params;return financeRead(r,owner=>loadInvoice(db,owner,id,month));}
export async function PUT(r:Request,c:Context){const {id,month}=await c.params;return financeWrite(r,(owner,key,input,expected)=>saveInvoice(db,owner,key,id,month,expected,input));}
