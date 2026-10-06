'use client';
import type { ManualAccountRecord,ManualCategoryRecord } from '@ecofinance/shared';
async function readFinance(url:string,signal:AbortSignal) {
  const response=await fetch(url,{signal,cache:'no-store'});
  if(!response.ok)throw new Error(response.status===401?'Sua sessão expirou. Entre novamente.':'Não foi possível carregar contas e categorias. Feche e tente novamente.');
  return response.json();
}
export async function loadEntryReferences(signal:AbortSignal):Promise<{accounts:ManualAccountRecord[];categories:ManualCategoryRecord[]}> {
  const [accounts,categories]=await Promise.all([readFinance('/api/accounts',signal),readFinance('/api/categories',signal)]);
  return {accounts:accounts.accounts,categories:categories.categories};
}
export async function saveFinance(url:string,method:string,input:unknown,key:string,version?:string):Promise<{id:string;revision:string}> {
  const response=await fetch(url,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key,...(version?{'If-Match':'"'+version+'"'}:{})},body:JSON.stringify(input)});
  if(!response.ok) {
    const result=await response.json().catch(()=>({}));
    throw new Error(response.status===401?'Sua sessão expirou. Entre novamente e tente salvar.':result.message??'Não foi possível salvar. Tente novamente com os mesmos dados.');
  }
  return response.json();
}
