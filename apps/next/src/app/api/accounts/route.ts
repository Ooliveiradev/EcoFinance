import { db } from '@ecofinance/db';
import { financeRead,financeWrite } from '@/lib/finance-http';
import { publicAccount,saveAccount } from '@/lib/manual-finance-service';
import { accountBalances,civilToday,decimalCents } from '@ecofinance/shared';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return financeRead(request,async ownerId=> {
    const [accounts,entries]=await Promise.all([db.owned('accounts',ownerId),db.owned('transactions',ownerId)]);
    const balances=accountBalances(accounts,entries,civilToday(new Date()));
    return {accounts:accounts.map(row=>({...publicAccount(row),balance:balances.get(row.id)==null?null:decimalCents(balances.get(row.id)!)}))};
  });
}
export async function POST(request:Request) {return financeWrite(request,(owner,key,input)=>saveAccount(db,owner,key,input),201);}
