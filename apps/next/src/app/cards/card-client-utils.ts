'use client';
import { useState } from 'react';
import type { CardCandidate,CardOccurrenceCandidate,CardTransaction } from '@ecofinance/shared';
export function useCardCandidates(id:string) {
  const [state,setState]=useState<{entries:CardCandidate[];occurrences:CardOccurrenceCandidate[];loading:boolean;error:string;hasMore:boolean}>({entries:[],occurrences:[],loading:false,error:'',hasMore:false});
  async function load(){setState(s=>({...s,loading:true,error:''}));try{const r=await fetch('/api/invoices/'+id+'/candidates',{cache:'no-store'});if(!r.ok)throw new Error('Falha ao carregar candidatos.');const data=await r.json();setState({...data,loading:false,error:''});}catch(e){setState(s=>({...s,loading:false,error:e instanceof Error?e.message:'Falha ao carregar.'}));}}
  return {...state,load};
}
export function useRefundPurchases(cardId:string,initial:CardTransaction[]) {
  const [state,setState]=useState({entries:initial,loading:false,error:''});
  async function load(month:string){setState(s=>({...s,loading:true,error:''}));try{const r=await fetch('/api/cards/'+cardId+'/invoices/'+month,{cache:'no-store'});if(!r.ok)throw new Error('Falha ao carregar compras.');const data=await r.json();setState({entries:data.entries,loading:false,error:''});}catch(e){setState(s=>({...s,loading:false,error:e instanceof Error?e.message:'Falha ao carregar.'}));}}
  return {...state,load};
}
