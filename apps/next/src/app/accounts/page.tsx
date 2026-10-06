import { db } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import AccountsClient from './accounts-client';
import { accountBalances,civilToday,decimalCents } from '@ecofinance/shared';
import { publicAccount,publicCategory } from '@/lib/manual-finance-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage() {
  const userId = await requirePageUser();
  try {
    const [accounts,categories,entries]=await Promise.all([db.owned('accounts',userId),db.owned('categories',userId),db.owned('transactions',userId)]);
    const balances=accountBalances(accounts,entries,civilToday(new Date()));
    const serialized=accounts.map(row=>({...publicAccount(row),balance:balances.get(row.id)==null?null:decimalCents(balances.get(row.id)!)}));
    return <AccountsClient initialAccounts={serialized} initialCategories={categories.map(publicCategory)} />;
  } catch { throw new Error('Não foi possível carregar suas contas. Tente novamente.'); }
}
