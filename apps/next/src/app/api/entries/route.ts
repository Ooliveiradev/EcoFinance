import { db } from '@ecofinance/db';
import { EntryQuerySchema } from '@ecofinance/shared';
import { authorize } from '@/lib/session';
import { ownedEntries } from '@/lib/owned-queries';
import { PRIVATE_CACHE } from '@/lib/access-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  const query = EntryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return Response.json({ error: 'INVALID_FILTER' }, { status: 400 });
  const rows = await ownedEntries(db, access.userId, query.data);
  return Response.json({ entries: rows }, { headers: { 'Cache-Control': PRIVATE_CACHE } });
}
