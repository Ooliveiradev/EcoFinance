'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PlanningView,PlanningRule,PlanningOccurrence } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import { usePlanningSave,type PlanningReferences } from './planning-client-utils';
import type { OccurrenceAction } from './occurrence-dialog';
import { PlanningSummary } from './planning-summary';
import { PlanningList } from './planning-list';
import { PlanningDialogs } from './planning-dialogs';
export type Selection={kind:'rule';row:PlanningRule|null}|{kind:'occurrence';row:PlanningOccurrence;action:OccurrenceAction}|{kind:'budget';copy:boolean}|{kind:'close'};
export function PlanningWorkspace({view,refs}:{view:PlanningView;refs:PlanningReferences}) {
  const router=useRouter(),[selected,setSelected]=useState<Selection|null>(null),month=view.month;
  function saved(){setSelected(null);router.refresh();}
  const mutation=usePlanningSave(saved),disabled=mutation.busy||view.closed;
  async function occurrenceState(row:PlanningOccurrence,action:'cancel'|'restore') {await mutation.save('/api/occurrences/'+row.id+'/'+action,'POST',{},row.revision);}
  return <>
    {mutation.error&&<p role="alert" className="text-danger">{mutation.error}</p>}
    <p className="text-sm text-muted">{view.closed?'Mês fechado: orçamento, ocorrências e lançamentos ficam protegidos. Reabra o mês para alterar.':'Mês aberto. Gere as previsões quando quiser planejar este período.'}</p><div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={()=>setSelected({kind:'rule',row:null})}>Nova recorrência</Button><Button disabled={disabled} variant="outline" onClick={()=>mutation.save('/api/planning/'+month+'/generate','POST',{})}>Gerar previsões do mês</Button><Button disabled={disabled} variant="outline" onClick={()=>setSelected({kind:'budget',copy:false})}>Editar orçamento</Button><Button disabled={disabled} variant="outline" onClick={()=>setSelected({kind:'budget',copy:true})}>Copiar orçamento</Button><Button disabled={mutation.busy} variant="ghost" onClick={()=>setSelected({kind:'close'})}>{view.closed?'Reabrir mês':'Fechar mês'}</Button></div>
    <PlanningSummary view={view} categories={refs.categories}/><PlanningList view={view} busy={mutation.busy} onRule={row=>setSelected({kind:'rule',row})} onOccurrence={(row,action)=>setSelected({kind:'occurrence',row,action})} onState={occurrenceState}/>
    <PlanningDialogs selected={selected} view={view} refs={refs} onClose={()=>setSelected(null)} onSaved={saved}/>
  </>;
}
