import { db } from '@ecofinance/db';
import { authorize } from '@/lib/session';
import { PRIVATE_CACHE } from '@/lib/access-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  const rows = (await db.owned('accounts', access.userId)).map(({id,name,type,currency,openingBalance,archivedAt}) => ({id,name,type,currency,openingBalance,archivedAt}));
  return Response.json({ accounts: rows }, { headers: { 'Cache-Control': PRIVATE_CACHE } });
}
