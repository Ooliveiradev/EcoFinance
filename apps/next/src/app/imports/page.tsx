import { db } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import ImportsClient, { type ImportBatchItem } from './imports-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportsPage() {
  const userId = await requirePageUser();
  try {
    const accountList = await db.owned('accounts', userId, {order:[{field:'name',direction:'asc'}]});

    let batches: ImportBatchItem[] = [];
    try {
      const batchResult = await db.owned('importBatches', userId, {order:[{field:'createdAt',direction:'desc'}],limit:10});

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
  } catch {
    return (
      <ImportsClient
        accounts={[]}
        recentBatches={[]}
        error={'Falha ao carregar contas para importação.'}
      />
    );
  }
}
