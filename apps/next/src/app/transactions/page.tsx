import { db } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import TransactionsClient from './transactions-client';
import { accountBalances,civilToday,decimalCents,manualListSchema,isMonthParam,type ManualEntryRecord } from '@ecofinance/shared';
import { listEntries,publicAccount,publicCategory } from '@/lib/manual-finance-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransactionsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const userId = await requirePageUser();
  try {
    const raw=await searchParams,{mes,...filters}=raw;
    if(mes!==undefined && (typeof mes!=='string' || !isMonthParam(mes)))throw new Error('Invalid month.');
    if(typeof filters.competenceMonth==='string' && /^\d{4}-\d{2}$/.test(filters.competenceMonth))filters.competenceMonth+='-01';
    const query=manualListSchema.parse({...filters,...(mes && !filters.competenceMonth?{competenceMonth:mes+'-01'}:{})});
    const [result,accounts,categories,entries]=await Promise.all([listEntries(db,userId,query),db.owned('accounts',userId),db.owned('categories',userId),db.owned('transactions',userId)]);
    const balances=accountBalances(accounts,entries,civilToday(new Date()));
    return <TransactionsClient initialData={result.entries as ManualEntryRecord[]} query={query} hasMore={result.hasMore} accounts={accounts.map(row=>({...publicAccount(row),balance:balances.get(row.id)==null?null:decimalCents(balances.get(row.id)!)}))} categories={categories.map(publicCategory)} />;
  } catch { throw new Error('Não foi possível carregar seus lançamentos. Tente novamente.'); }
}
