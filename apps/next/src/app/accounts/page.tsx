import { db, accounts } from '@ecofinance/db';
import AccountsClient from './accounts-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AccountsPage() {
  try {
    const allAccounts = await db.select().from(accounts);
    return <AccountsClient initialAccounts={allAccounts} />;
  } catch {
    return <AccountsClient initialAccounts={[]} />;
  }
}
