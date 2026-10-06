import { db } from '@ecofinance/db';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { listEntries,saveEntry } from '@/lib/manual-finance-service';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return financeRead(request,owner=>listEntries(db,owner,Object.fromEntries(new URL(request.url).searchParams)));
}
export async function POST(request:Request) {return financeWrite(request,(owner,key,input)=>saveEntry(db,owner,key,input),201);}
