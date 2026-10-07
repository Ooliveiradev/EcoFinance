'use client';
import type { FormEvent } from 'react';
import type { PlanningRule } from '@ecofinance/shared';
import { FinanceDialog } from '@/components/finance-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlanningSave,moneyText,selectClass,type PlanningReferences } from './planning-client-utils';
export function RuleDialog({row,month,refs,onClose,onSaved}:{row:PlanningRule|null;month:string;refs:PlanningReferences;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,save}=usePlanningSave(onSaved);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=new FormData(event.currentTarget),text=(key:string)=>String(data.get(key)??'');
    const fromMonth=row?text('fromMonth'):[month,text('startDate').slice(0,7)].sort()[1]!;
    await save('/api/recurrences'+(row?'/'+row.id:''),row?'PATCH':'POST',{fromMonth,schedule:{description:text('description'),amount:moneyText(data.get('amount')),accountId:text('accountId'),categoryId:text('categoryId'),startDate:text('startDate'),endDate:text('endDate')||null,dueDay:Number(text('dueDay')),estimated:data.has('estimated'),reminderDays:text('reminderDays')===''?null:Number(text('reminderDays')),paused:data.has('paused')}},row?.revision);
  }
  const title=row?'Editar próximas ocorrências':'Nova recorrência';
  return <FinanceDialog title={title} onClose={onClose} busy={busy}><form onSubmit={submit} className="space-y-4">
    {error&&<p role="alert" className="text-danger">{error}</p>}
    <p className="text-sm text-muted">Vencimentos fora do início/fim não geram previsão. Dia 31 usa o último dia de meses menores. Pagamentos e ajustes feitos só em uma ocorrência são preservados.</p>
    {row&&<label className="block text-sm">Alterar a partir de<Input name="fromMonth" type="month" defaultValue={month} required/></label>}
    <label className="block text-sm">Descrição<Input name="description" defaultValue={row?.description??''} maxLength={500} required/></label>
    <label className="block text-sm">Valor previsto (R$)<Input name="amount" inputMode="decimal" defaultValue={row?.amount??''} required/></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" name="estimated" defaultChecked={row?.estimated??false}/>Valor estimado</label>
    <label className="block text-sm">Conta<select aria-label="Conta" name="accountId" className={selectClass} defaultValue={row?.accountId??''} required><option value="">Escolha</option>{refs.accounts.filter(a=>!a.archivedAt||a.id===row?.accountId).map(a=><option key={a.id} value={a.id}>{a.name}{a.archivedAt?' (arquivada)':''}</option>)}</select></label>
    <label className="block text-sm">Categoria<select aria-label="Categoria" name="categoryId" className={selectClass} defaultValue={row?.categoryId??''} required><option value="">Escolha</option>{refs.categories.filter(c=>!c.archivedAt||c.id===row?.categoryId).map(c=><option key={c.id} value={c.id}>{c.name}{c.archivedAt?' (arquivada)':''}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Início<Input name="startDate" type="date" defaultValue={row?.startDate??month+'-01'} required/></label><label className="block text-sm">Fim opcional<Input name="endDate" type="date" defaultValue={row?.endDate??''}/></label></div>
    <label className="block text-sm">Dia de vencimento<Input name="dueDay" type="number" min={1} max={31} defaultValue={row?.dueDay??1} required/></label>
    <label className="block text-sm">Lembrar quantos dias antes<Input name="reminderDays" type="number" min={0} max={30} defaultValue={row?.reminderDays??''}/></label><p className="text-xs text-muted">O lembrete aparece neste planejamento. Deixe vazio para desativar.</p>
    <label className="flex gap-2 text-sm"><input name="paused" type="checkbox" defaultChecked={row?.paused??false}/>Pausar a partir deste mês</label>
    <Button type="submit" disabled={busy}>{busy?'Salvando…':'Salvar recorrência'}</Button>
  </form></FinanceDialog>;
}
