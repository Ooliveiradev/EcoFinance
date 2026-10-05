import { resolveMonthParam, monthBounds } from '@ecofinance/shared';
import { requirePageUser } from '@/lib/session';
import { loadDashboardData } from '@/lib/dashboard-data';
import DashboardClient from './dashboard-client';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ mes?: string }> }) {
  const userId = await requirePageUser();
  const params = searchParams ? await searchParams : {};
  const resolved = resolveMonthParam(typeof params.mes === 'string' ? params.mes : null, new Date());
  const data = await loadDashboardData(userId, resolved, monthBounds(resolved.month)!);
  return <DashboardClient {...data} />;
}
