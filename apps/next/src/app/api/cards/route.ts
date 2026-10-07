import { db } from '@ecofinance/db';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { saveCard,publicCard } from '@/lib/card-store';
export const dynamic='force-dynamic';
export async function GET(r:Request){return financeRead(r,async owner=>({cards:(await db.owned('cards',owner,{order:[{field:'name',direction:'asc'}]})).map(publicCard)}));}
export async function POST(r:Request){return financeWrite(r,(owner,key,input)=>saveCard(db,owner,key,input),201);}
