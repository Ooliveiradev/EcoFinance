import { db } from '@ecofinance/db';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { publicCategory,saveCategory } from '@/lib/manual-finance-service';
export const dynamic='force-dynamic';
export async function GET(request:Request) {return financeRead(request,async owner=>({categories:(await db.owned('categories',owner,{order:[{field:'sortOrder',direction:'asc'},{field:'name',direction:'asc'}]})).map(publicCategory)}));}
export async function POST(request:Request) {return financeWrite(request,(owner,key,input)=>saveCategory(db,owner,key,input),201);}
