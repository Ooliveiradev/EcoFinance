import { db } from '@ecofinance/db';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { FinanceError } from '@/lib/finance-operation';
import { cardCandidates } from '@/lib/card-read';
import { addInvoiceItem,payInvoice } from '@/lib/card-purchases';
import { reconcileCardEntry,reconcileCardOccurrence } from '@/lib/card-reconcile';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string;action:string}>};
export async function GET(r:Request,c:Context){const {id,action}=await c.params;return financeRead(r,owner=>{if(action!=='candidates')throw new FinanceError('NOT_FOUND',404,'Ação indisponível.');return cardCandidates(db,owner,id);});}
export async function POST(r:Request,c:Context){const {id,action}=await c.params;return financeWrite(r,(owner,key,input,expected)=>{
  if(action==='items')return addInvoiceItem(db,owner,key,id,expected,input);
  if(action==='pay')return payInvoice(db,owner,key,id,expected,input);
  if(action==='reconcile')return reconcileCardEntry(db,owner,key,id,expected,input);
  if(action==='occurrence')return reconcileCardOccurrence(db,owner,key,id,expected,input);
  throw new FinanceError('NOT_FOUND',404,'Ação indisponível.');
});}
