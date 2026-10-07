'use client';
import { formatCents } from '@ecofinance/shared';
import { useRef,useState } from 'react';
import { saveFinance } from '@/lib/finance-client';
import type { BudgetPlan } from '@ecofinance/shared';
export interface PlanningReference {id:string;name:string;archivedAt:string|null}
export interface PlanningReferences {accounts:PlanningReference[];categories:PlanningReference[]}
export const selectClass='w-full rounded-xl border border-border bg-surface p-2';
export const moneyText=(value:FormDataEntryValue|null)=>String(value??'').trim().replace(',','.');
export function usePlanningSave(onSaved:()=>void) {
  const request=useRef({payload:'',key:''}),[state,setState]=useState({busy:false,error:''});
  async function save(url:string,method:string,input:unknown,version?:string) {
    const serialized=JSON.stringify([url,method,input,version]);
    if(request.current.payload!==serialized)request.current={payload:serialized,key:crypto.randomUUID()};
    setState({busy:true,error:''});
    try {await saveFinance(url,method,input,request.current.key,version);onSaved();}
    catch(error){setState({busy:false,error:error instanceof Error?error.message:'Falha ao salvar.'});return;}
    setState({busy:false,error:''});
  }
  return {...state,save};
}
export function readPlan(form:HTMLFormElement):BudgetPlan {
  const data=new FormData(form);
  return {limit:moneyText(data.get('limit')),expectedIncome:moneyText(data.get('expectedIncome')),reserve:moneyText(data.get('reserve')),categories:[...data.entries()].filter(([key,value])=>key.startsWith('category:')&&String(value).trim()!=='').map(([key,value])=>({categoryId:key.slice(9),limit:moneyText(value)}))};
}
export const planningMoney=(value:string)=>formatCents(BigInt(value.replace('.','')));
