import { db } from '@ecofinance/db';
import { requirePageUser } from '@/lib/session';
import ImportsClient from './imports-client';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function ImportsPage() {
  const owner = await requirePageUser();
  try {
    const [accounts, cards, categories, batches] = await Promise.all([
      db.owned('accounts', owner, { where: [{ field: 'archivedAt', value: null }], order: [{ field: 'name', direction: 'asc' }] }),
      db.owned('cards', owner, { where: [{ field: 'archivedAt', value: null }], order: [{ field: 'name', direction: 'asc' }] }),
      db.owned('categories', owner, { where: [{ field: 'archivedAt', value: null }], order: [{ field: 'name', direction: 'asc' }] }),
      db.owned('importBatches', owner, { order: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }], limit: 20 }),
    ]);
    const reference = (rows: { id: string; name: string }[]) => rows.map(({ id, name }) => ({ id, name }));
    return <ImportsClient accounts={reference(accounts)} cards={reference(cards)} categories={reference(categories)} recentBatches={batches.map(b => ({ id: b.id, filename: b.filename ?? 'Lote legado', state: b.state, format: b.format ?? b.source,createdAt:b.createdAt.toISOString() }))} />;
  } catch {
    return <ImportsClient accounts={[]} cards={[]} categories={[]} recentBatches={[]} error="Falha ao carregar contas, cartões e histórico. Recarregue a página para tentar novamente." />;
  }
}
