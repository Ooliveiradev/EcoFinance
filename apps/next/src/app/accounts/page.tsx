import { db, accounts, eq } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import AccountsClient from './accounts-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage() {
  const userId = await requirePageUser();
  try {
    const allAccounts = await db.select().from(accounts).where(eq(accounts.ownerId, userId));
    return <AccountsClient initialAccounts={allAccounts} />;
  } catch { throw new Error('Não foi possível carregar suas contas. Tente novamente.'); }
}
