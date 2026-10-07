'use client';
import { PlanFields } from './planning-form';
import { useState,type FormEvent } from 'react';
import { shiftMonth,type BudgetPlan } from '@ecofinance/shared';
import { FinanceDialog } from '@/components/finance-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readPlan,usePlanningSave,type PlanningReference } from './planning-client-utils';
interface CopyPreview {sourceMonth:string;sourceRevision:string;plan:BudgetPlan}
export function BudgetDialog({month,plan,categories,copy,onClose,onSaved}:{month:string;plan:(BudgetPlan&{revision:string})|null;categories:PlanningReference[];copy:boolean;onClose:()=>void;onSaved:()=>void}) {
  const mutation=usePlanningSave(onSaved),[source,setSource]=useState(()=>shiftMonth(month,-1)??month),[preview,setPreview]=useState<CopyPreview|null>(null),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState('');
  async function loadPreview() {
    setLoading(true);setLoadError('');setPreview(null);
    try {
      const response=await fetch('/api/planning/copy-preview?from='+source,{cache:'no-store'});
      if(!response.ok)throw new Error('Não foi possível ler o orçamento de origem. Escolha um mês com plano salvo.');
      setPreview(await response.json());
    } catch(error){setLoadError(error instanceof Error?error.message:'Falha ao carregar.');}finally{setLoading(false);}
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(copy&&!preview)return;
    const reviewed=readPlan(event.currentTarget);
    await mutation.save('/api/planning/'+month+(copy?'/copy':''),copy?'POST':'PUT',copy?{sourceMonth:preview!.sourceMonth,sourceRevision:preview!.sourceRevision,plan:reviewed}:reviewed,plan?.revision);
  }
  const ready=!copy||preview,busy=loading||mutation.busy;
  return <FinanceDialog title={copy?'Revisar cópia do orçamento':'Editar orçamento'} onClose={onClose} busy={busy}>
    {copy&&<div className="space-y-3 mb-5"><label className="block text-sm">Mês de origem<Input type="month" disabled={busy} value={source} onChange={e=>{setSource(e.target.value);setPreview(null);}}/></label><Button onClick={loadPreview} disabled={busy||source===month}>Carregar para revisão</Button><p className="text-sm text-muted">Revise todos os valores antes de substituir o plano de {month}. As recorrências continuam com suas próprias regras; a cópia não cria outras recorrências.</p></div>}
    {(loadError||mutation.error)&&<p role="alert" className="text-danger">{loadError||mutation.error}</p>}
    {ready&&<form key={preview?.sourceRevision??'current'} onSubmit={submit} className="space-y-4"><PlanFields plan={copy?preview!.plan:plan} categories={categories}/><Button type="submit" disabled={busy}>{busy?'Salvando…':copy?'Confirmar plano revisado':'Salvar orçamento'}</Button></form>}
  </FinanceDialog>;
}
