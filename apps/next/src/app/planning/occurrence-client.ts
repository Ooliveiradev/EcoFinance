'use client';
import { useState } from 'react';
import type { OccurrenceAction } from './occurrence-dialog';
import { moneyText } from './planning-client-utils';
export interface Candidate {id:string;revision:string;description:string;amount:string;source:string;paidDate:string|null}
export function useCandidates(id:string) {
  const [state,setState]=useState<{entries:Candidate[]|null;loading:boolean;error:string}>({entries:null,loading:false,error:''});
  async function load() {
    setState({entries:null,loading:true,error:''});
    try {
      const response=await fetch('/api/occurrences/'+id+'/candidates',{cache:'no-store'});
      if(!response.ok)throw new Error('Não foi possível consultar lançamentos.');
      const result=await response.json();setState({entries:result.entries,loading:false,error:result.hasMore?'Mostrando os primeiros 100 lançamentos.':''});
    } catch(e){setState({entries:null,loading:false,error:e instanceof Error?e.message:'Falha ao carregar.'});}
  }
  return {...state,load};
}
export function occurrenceInput(action:OccurrenceAction,data:FormData,candidate:Candidate|undefined) {
  const text=(key:string)=>String(data.get(key)??'');
  if(action==='edit')return {description:text('description'),amount:moneyText(data.get('amount')),dueDate:text('dueDate')};
  if(action==='postpone')return {dueDate:text('dueDate')};
  if(action==='reconcile')return {transactionId:candidate?.id??'',transactionRevision:candidate?.revision??'',paidDate:candidate?.paidDate??text('paidDate')};
  return {amount:moneyText(data.get('amount')),paidDate:text('paidDate')};
}
