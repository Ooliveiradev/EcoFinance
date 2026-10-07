import { db } from '@ecofinance/db';
import { resolveMonthParam } from '@ecofinance/shared';
import { requirePageUser } from '@/lib/session';
import { publicCard } from '@/lib/card-store';
import { loadInvoice } from '@/lib/card-read';
import { publicAccount,publicCategory } from '@/lib/manual-finance-service';
import CardsClient from './cards-client';
export const dynamic='force-dynamic';
export const revalidate=0;
export default async function CardsPage({searchParams}:{searchParams?:Promise<{mes?:string;card?:string}>}) {
  const owner=await requirePageUser(),params=searchParams?await searchParams:{},resolved=resolveMonthParam(params.mes,new Date());
  try {
    const [cards,accounts,categories]=await Promise.all([db.owned('cards',owner,{order:[{field:'name',direction:'asc'}]}),db.owned('accounts',owner,{order:[{field:'name',direction:'asc'}]}),db.owned('categories',owner,{order:[{field:'name',direction:'asc'}]})]);
    const selected=params.card?cards.find(c=>c.id===params.card):cards.find(c=>!c.archivedAt)??cards[0];
    const view=selected?await loadInvoice(db,owner,selected.id,resolved.month):null;
    return <CardsClient month={resolved.month} cards={cards.map(publicCard)} selectedId={selected?.id??null} invoice={view} refs={{accounts:accounts.map(publicAccount),categories:categories.map(publicCategory)}} error={!resolved.valid?'Mês inválido; exibindo o mês atual.':params.card&&!selected?'Cartão indisponível.':undefined}/>;
  } catch {return <CardsClient month={resolved.month} cards={[]} selectedId={null} invoice={null} refs={{accounts:[],categories:[]}} error="Falha ao carregar cartões e faturas. Tente recarregar."/>;}
}
