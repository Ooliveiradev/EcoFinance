import { db, transactions, desc } from '@ecofinance/db';
import TransactionsClient from './transactions-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransactionsPage() {
  try {
    const allTx = await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.date));

    // Serialize dates to ISO strings before passing to Client Component
    const serialized = allTx.map((tx) => ({
      ...tx,
      date: tx.date.toISOString(),
    }));

    return <TransactionsClient initialData={serialized} />;
  } catch {
    return <TransactionsClient initialData={[]} />;
  }
}
