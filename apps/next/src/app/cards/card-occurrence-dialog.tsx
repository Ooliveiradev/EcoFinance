'use client';
import { useState,type FormEvent } from 'react';
import type { InvoiceView,CardTransaction } from '@ecofinance/shared';
import { FinanceDialog } from '@/components/finance-dialog';
import { Button } from '@/components/ui/button';
import { usePlanningSave,selectClass,planningMoney } from '../planning/planning-client-utils';
import { CardConfirmation } from './card-fields';
import { useCardCandidates } from './card-client-utils';
export function CardOccurrenceDialog({invoice,entry,onClose,onSaved}:{invoice:InvoiceView;entry:CardTransaction;onClose:()=>void;onSaved:()=>void}) {
  const mutation=usePlanningSave(onSaved),candidates=useCardCandidates(invoice.id),[selected,setSelected]=useState(''),occurrence=candidates.occurrences.find(o=>o.id===selected),busy=mutation.busy||candidates.loading;
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!occurrence)return;await mutation.save('/api/invoices/'+invoice.id+'/occurrence','POST',{transactionId:entry.id,transactionRevision:entry.revision,occurrenceId:occurrence.id,occurrenceRevision:occurrence.revision,confirmed:true},invoice.revision);}
  return <FinanceDialog title="Conciliar previsão com compra" busy={busy} onClose={onClose}><form className="space-y-4" onSubmit={submit}>{(mutation.error||candidates.error)&&<p role="alert">{mutation.error||candidates.error}</p>}<p className="break-words font-semibold">{entry.description} · {planningMoney(entry.amount)}</p><p className="text-sm text-muted">Vincule uma previsão da mesma competência, conta e categoria. O valor da compra substitui o previsto. A previsão deixa de ficar pendente, sem outra despesa ou saída de caixa; o caixa muda ao pagar a fatura.</p><Button type="button" variant="outline" disabled={busy} onClick={candidates.load}>Carregar previsões pendentes</Button><label className="block text-sm">Previsão<select aria-label="Previsão" className={selectClass} value={selected} onChange={e=>setSelected(e.target.value)} required><option value="">Selecione</option>{candidates.occurrences.filter(o=>o.categoryId===entry.categoryId).map(o=><option key={o.id} value={o.id}>{o.description} · {planningMoney(o.amount)}</option>)}</select></label><CardConfirmation label="Confirmo que esta compra corresponde à previsão selecionada."/><Button type="submit" disabled={busy||!occurrence}>Confirmar vínculo com previsão</Button></form></FinanceDialog>;
}
