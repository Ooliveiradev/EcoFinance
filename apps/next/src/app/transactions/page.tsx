import { db, transactions, desc, eq } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import TransactionsClient from './transactions-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TransactionsPage() {
  const userId = await requirePageUser();
  try {
    const allTx = await db
      .select()
      .from(transactions)
      .where(eq(transactions.ownerId, userId))
      .orderBy(desc(transactions.date));

    // Serialize dates to ISO strings before passing to Client Component
    const serialized = allTx.map((tx) => ({
      ...tx,
      date: tx.date.toISOString(),
    }));

    return <TransactionsClient initialData={serialized} />;
  } catch { throw new Error('Não foi possível carregar seus lançamentos. Tente novamente.'); }
}
