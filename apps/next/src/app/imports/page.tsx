import { db, accounts, importBatches, desc, eq } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import ImportsClient, { type ImportBatchItem } from './imports-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportsPage() {
  const userId = await requirePageUser();
  try {
    const accountList = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        balance: accounts.balance,
      })
      .from(accounts)
      .where(eq(accounts.ownerId, userId))
      .orderBy(accounts.name);

    let batches: ImportBatchItem[] = [];
    try {
      const batchResult = await db
        .select({
          id: importBatches.id,
          source: importBatches.source,
          state: importBatches.state,
          createdAt: importBatches.createdAt,
        })
        .from(importBatches)
        .where(eq(importBatches.ownerId, userId))
        .orderBy(desc(importBatches.createdAt))
        .limit(10);

      batches = batchResult.map((b) => ({
        id: b.id,
        source: b.source,
        state: b.state,
        createdAt: b.createdAt.toISOString(),
      }));
    } catch {
      batches = [];
    }

    return (
      <ImportsClient
        accounts={accountList.map((a) => ({
          id: a.id,
          name: a.name,
          balance: Number(a.balance),
        }))}
        recentBatches={batches}
      />
    );
  } catch (error) {
    return (
      <ImportsClient
        accounts={[]}
        recentBatches={[]}
        error={error instanceof Error ? error.message : 'Falha ao carregar contas para importação.'}
      />
    );
  }
}
