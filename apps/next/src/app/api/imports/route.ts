import { db } from '@ecofinance/db';
import { financeRead } from '@/lib/finance-http';
import { uploadImports } from '@/lib/import-upload';
import { fail } from '@/lib/finance-operation';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return financeRead(request, async owner => {
    const cursor = new URL(request.url).searchParams.get('page') ?? '1';
    if (!/^[1-9]\d{0,2}$/.test(cursor)) fail('INVALID_PAGE',400,'Página inválida. Informe um número de 1 a 999.');
    const batches = await db.owned('importBatches', owner, { order: [{ field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }], offset: (Number(cursor) - 1) * 20, limit: 21 });
    return { batches: batches.slice(0, 20).map(b => ({ id: b.id, filename: b.filename ?? 'Lote legado', state: b.state, format: b.format ?? b.source,createdAt:b.createdAt.toISOString() })), hasMore: batches.length > 20 };
  });
}
export async function POST(request: Request) { return uploadImports(db, request); }
