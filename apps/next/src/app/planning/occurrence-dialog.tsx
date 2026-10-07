'use client';
import { useState,type FormEvent } from 'react';
import { civilToday,type PlanningOccurrence } from '@ecofinance/shared';
import { FinanceDialog } from '@/components/finance-dialog';
import { Button } from '@/components/ui/button';
import { usePlanningSave } from './planning-client-utils';
import { useCandidates,occurrenceInput } from './occurrence-client';
import { OccurrenceFields,ReconciliationFields } from './occurrence-fields';
export type OccurrenceAction='pay'|'edit'|'postpone'|'reconcile';
export function OccurrenceDialog({row,action,onClose,onSaved}:{row:PlanningOccurrence;action:OccurrenceAction;onClose:()=>void;onSaved:()=>void}) {
  const mutation=usePlanningSave(onSaved),[today]=useState(()=>civilToday(new Date())),[selected,setSelected]=useState(''),candidates=useCandidates(row.id);
  const candidate=candidates.entries?.find(c=>c.id===selected),title=({pay:'Pagar ocorrência',edit:'Editar só esta ocorrência',postpone:'Adiar ocorrência',reconcile:'Conciliar lançamento importado'})[action];
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();await mutation.save('/api/occurrences/'+row.id+'/'+action,'POST',occurrenceInput(action,new FormData(event.currentTarget),candidate),row.revision);
  }
  const busy=mutation.busy||candidates.loading,error=candidates.error||mutation.error,label=({pay:'Confirmar pagamento',reconcile:'Confirmar conciliação',edit:'Salvar alteração',postpone:'Salvar alteração'})[action];
  return <FinanceDialog title={title} onClose={onClose} busy={busy}><form onSubmit={submit} className="space-y-4"><p className="font-semibold break-words">{row.description}</p>
    <p className="text-sm text-muted">Competência {row.competenceMonth.slice(0,7)}. Adiar muda o vencimento; a despesa continua nesta competência. O valor pago pode ser diferente da previsão.</p>
    {error&&<p role="alert" className="text-danger">{error}</p>}
    {action==='reconcile'&&<ReconciliationFields candidates={candidates.entries} selected={selected} busy={busy} onLoad={candidates.load} onSelect={setSelected}/>}
    <OccurrenceFields action={action} row={row} today={today} candidate={candidate}/>
    <Button type="submit" disabled={busy||(action==='reconcile'&&!candidate)}>{busy?'Salvando…':label}</Button>
  </form></FinanceDialog>;
}
