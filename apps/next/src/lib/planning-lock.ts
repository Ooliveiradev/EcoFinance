import { randomUUID } from 'node:crypto';
import type { Database } from '@ecofinance/db';
import { hash,fail } from './finance-operation';
export function stableId(parts:unknown) {
  const h=hash(parts);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function monthState(tx:Database,ownerId:string,month:string) {
  return await tx.get('planningMonths',stableId(['month',ownerId,month])) ?? {id:stableId(['month',ownerId,month]),ownerId,competenceMonth:month+'-01',closedAt:null,revision:'new',updatedAt:new Date()};
}
export async function assertMonthOpen(tx:Database,ownerId:string,month:string) {
  const state=await monthState(tx,ownerId,month);
  if(state.closedAt)fail('MONTH_CLOSED',409,'Mês fechado. Reabra o planejamento para alterar este período.');
  return state;
}
export async function touchMonth(tx:Database,ownerId:string,month:string) {
  await touchMonths(tx,ownerId,[month]);
}
export async function touchMonths(tx:Database,ownerId:string,months:string[]) {
  const states=await Promise.all([...new Set(months)].map(month=>assertMonthOpen(tx,ownerId,month)));
  await tx.putMany('planningMonths',states.map(state=>({...state,revision:randomUUID(),updatedAt:new Date()})));
}
