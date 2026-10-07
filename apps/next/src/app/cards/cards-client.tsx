'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CardRecord,InvoiceView } from '@ecofinance/shared';
import { MonthSelector } from '@/components/month-selector';
import { usePlanningSave,selectClass,type PlanningReferences } from '../planning/planning-client-utils';
import { CardsDialogs,type CardSelection } from './cards-dialogs';
import { CardToolbar,CardActions } from './card-toolbar';
import { InvoiceSummary } from './invoice-summary';
import { InvoiceList } from './invoice-list';
export default function CardsClient({month,cards,selectedId,invoice,refs,error}:{month:string;cards:CardRecord[];selectedId:string|null;invoice:InvoiceView|null;refs:PlanningReferences;error?:string}) {
  const router=useRouter(),[selection,setSelection]=useState<CardSelection>(null),card=cards.find(c=>c.id===selectedId);
  function saved(){setSelection(null);router.refresh();}
  const mutation=usePlanningSave(saved),disabled=mutation.busy||!!card?.archived||!!invoice?.monthClosed;
  return <div className="space-y-6"><header className="space-y-3"><h1 className="text-2xl font-bold">Cartões e faturas</h1><p className="text-sm text-muted">Compras por competência; pagamentos separados no caixa.</p><MonthSelector currentMonth={month}/></header>{(error||mutation.error)&&<p role="alert">{error||mutation.error}</p>}<CardActions card={card} busy={mutation.busy} onSelect={setSelection} onArchive={()=>{if(card)mutation.save('/api/cards/'+card.id,'PATCH',{action:card.archived?'restore':'archive'},card.revision);}}/>{cards.length>0?<label className="block text-sm">Cartão<select aria-label="Cartão" className={selectClass} value={selectedId??''} onChange={e=>router.push('/cards?mes='+month+'&card='+e.target.value)}>{cards.map(c=><option key={c.id} value={c.id}>{c.name}{c.archived?' (arquivado)':''}</option>)}</select></label>:<p>Cadastre um cartão para começar.</p>}
    {card&&invoice&&<><CardToolbar invoice={invoice} disabled={disabled} onSelect={setSelection}/><InvoiceSummary invoice={invoice} accountName={refs.accounts.find(a=>a.id===invoice.paymentAccountId)?.name??'Conta histórica'}/><InvoiceList invoice={invoice} disabled={disabled} onOccurrence={entry=>setSelection({entry})}/></>}
    <CardsDialogs selection={selection} card={card} invoice={invoice} month={month} refs={refs} onClose={()=>setSelection(null)} onSaved={saved}/>
  </div>;
}
