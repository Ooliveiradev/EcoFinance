import { db, accounts, eq } from '@ecofinance/db';
import { authorize } from '@/lib/session';
import { PRIVATE_CACHE } from '@/lib/access-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  const rows = await db.select({ id: accounts.id, name: accounts.name, type: accounts.type, currency: accounts.currency, openingBalance: accounts.openingBalance, archivedAt: accounts.archivedAt })
    .from(accounts).where(eq(accounts.ownerId, access.userId));
  return Response.json({ accounts: rows }, { headers: { 'Cache-Control': PRIVATE_CACHE } });
}
