import { db } from '@ecofinance/db';
import { resolveMonthParam } from '@ecofinance/shared';
import { loadPlanning } from '@/lib/planning-read';
import { publicAccount,publicCategory } from '@/lib/manual-finance-service';
import PlanningClient from './planning-client';
import { requirePageUser } from '@/lib/session';
export const dynamic='force-dynamic';
export const revalidate=0;
export default async function PlanningPage({searchParams}:{searchParams?:Promise<{mes?:string}>}) {
  const owner=await requirePageUser(),params=searchParams?await searchParams:{};
  const resolved=resolveMonthParam(typeof params.mes==='string'?params.mes:null,new Date());
  try {
    const [view,accounts,categories]=await Promise.all([loadPlanning(db,owner,resolved.month),db.owned('accounts',owner,{order:[{field:'name',direction:'asc'}]}),db.owned('categories',owner,{order:[{field:'sortOrder',direction:'asc'},{field:'name',direction:'asc'}]})]);
    return <PlanningClient month={resolved.month} isCurrentMonth={resolved.isCurrent} view={view} refs={{accounts:accounts.map(publicAccount),categories:categories.map(publicCategory)}} error={resolved.valid?undefined:'Mês inválido; exibindo o mês atual.'}/>;
  } catch {return <PlanningClient month={resolved.month} isCurrentMonth={resolved.isCurrent} view={null} refs={{accounts:[],categories:[]}} error="Falha ao carregar planejamento. Tente recarregar."/>;}
}
