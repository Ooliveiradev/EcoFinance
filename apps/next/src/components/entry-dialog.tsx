'use client';
import { useRef,useState,type FormEvent } from 'react';
import Link from 'next/link';
import { civilToday,type ManualEntryRecord } from '@ecofinance/shared';
import { FinanceDialog } from './finance-dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { saveFinance } from '@/lib/finance-client';
export interface EntryReference {id:string;name:string;archivedAt?:string|null}
interface EntryDialogProps {accounts:EntryReference[];categories:EntryReference[];initial?:ManualEntryRecord;onClose:()=>void;onSaved:()=>void}
const selectClass='w-full rounded-xl border border-border bg-surface p-2';
function entryDraft(initial:ManualEntryRecord|undefined,today:string) {
  return {
    kind:initial && ['income','expense','transfer'].includes(initial.kind)?initial.kind:'expense',
    status:initial?.status??'settled',description:initial?.description??'',amount:initial?.amount.replace('-','')??'',
    accountId:initial?.transferFromAccountId??initial?.accountId??'',toAccountId:initial?.toAccountId??'',categoryId:initial?.categoryId??'',
    purchaseDate:initial?.purchaseDate??today,competenceMonth:initial?.competenceMonth.slice(0,7)??today.slice(0,7),
    dueDate:initial?.dueDate??'',paidDate:initial?.paidDate??today,notes:initial?.notes??'',
  };
}
type Draft=ReturnType<typeof entryDraft>;
function titleFor(initial:ManualEntryRecord|undefined,kind:string) {return initial?'Editar lançamento':kind==='expense'?'Adicionar Gasto':'Novo lançamento';}
function availableReferences(rows:EntryReference[],first:string,second='') {return rows.filter(row=>!row.archivedAt || row.id===first || row.id===second);}
function useEntrySave(initial:ManualEntryRecord|undefined,kind:string,status:string,onSaved:()=>void) {
  const key=useRef(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget),value=(name:string)=>String(form.get(name)??'');
    const input={accountId:value('accountId'),categoryId:value('categoryId'),toAccountId:kind==='transfer'?value('toAccountId'):null,kind,status,description:value('description'),amount:value('amount').trim().replace(',','.'),purchaseDate:value('purchaseDate'),competenceMonth:value('competenceMonth')+'-01',dueDate:value('dueDate')||null,paidDate:status==='settled'?(value('paidDate')||null):null,notes:value('notes')||null};
    if(!key.current)key.current=crypto.randomUUID();setPending(true);setError('');
    try {await saveFinance('/api/entries'+(initial?'/'+initial.id:''),initial?'PATCH':'POST',input,key.current,initial?.revision);onSaved();}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar.');}finally{setPending(false);}
  }
  return {submit,pending,error};
}
export function EntryDialog({accounts,categories,initial,onClose,onSaved}:EntryDialogProps) {
  const [draft]=useState(()=>entryDraft(initial,civilToday(new Date())));
  const [kind,setKind]=useState(draft.kind),[status,setStatus]=useState(draft.status);
  const availableAccounts=availableReferences(accounts,draft.accountId,draft.toAccountId),availableCategories=availableReferences(categories,draft.categoryId);
  const missing=!availableAccounts.length || !availableCategories.length;
  const {submit,pending,error}=useEntrySave(initial,kind,status,onSaved);
  return <FinanceDialog title={titleFor(initial,kind)} onClose={onClose} busy={pending}><form onSubmit={submit} className="space-y-4">
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {missing && <p className="text-sm text-muted">Cadastre uma conta e uma categoria em <Link className="underline" href="/accounts">Contas e categorias</Link> para registrar lançamentos.</p>}
    <fieldset disabled={pending} className="space-y-4">
      <EntryBasics draft={draft} kind={kind} onKind={setKind} initial={initial}/>
      <ReferenceFields draft={draft} kind={kind} accounts={availableAccounts} categories={availableCategories}/>
      <DateFields draft={draft} kind={kind} status={status} onStatus={setStatus}/>
      <label className="block text-sm">Notas<textarea aria-label="Notas" name="notes" defaultValue={draft.notes} maxLength={2000} className="w-full rounded-xl border border-border bg-surface p-3" rows={3}/></label>
    </fieldset>
    <SubmitButtons pending={pending} missing={missing} kind={kind} onClose={onClose}/>
  </form></FinanceDialog>;
}
function EntryBasics({draft,kind,onKind,initial}:{draft:Draft;kind:string;onKind:(value:string)=>void;initial?:ManualEntryRecord}) {
  return <><label className="block text-sm">{kind==='expense'?'Descrição do gasto *':'Descrição *'}<Input name="description" maxLength={500} defaultValue={draft.description} required/></label>
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Tipo<select aria-label="Tipo" name="kind" value={kind} onChange={e=>onKind(e.target.value)} disabled={initial?.kind==='transfer'} className={selectClass}><option value="expense">Despesa</option><option value="income">Receita</option><option value="transfer" disabled={!!initial && initial.kind!=='transfer'}>Transferência</option></select></label><label className="block text-sm">Valor (R$) *<Input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={draft.amount} required/></label></div>
  </>;
}
function ReferenceOptions({rows}:{rows:EntryReference[]}) {return rows.map(row=><option key={row.id} value={row.id}>{row.name}{row.archivedAt?' (arquivada)':''}</option>);}
function ReferenceFields({draft,kind,accounts,categories}:{draft:Draft;kind:string;accounts:EntryReference[];categories:EntryReference[]}) {
  return <><label className="block text-sm">{kind==='income'?'Conta de entrada':'Conta de saída'}<select aria-label={kind==='income'?'Conta de entrada':'Conta de saída'} name="accountId" defaultValue={draft.accountId || accounts[0]?.id || ''} className={selectClass} required><option value="" disabled>Escolha uma conta</option><ReferenceOptions rows={accounts}/></select></label>
    {kind==='transfer' && <label className="block text-sm">Conta de destino<select aria-label="Conta de destino" name="toAccountId" defaultValue={draft.toAccountId} className={selectClass} required><option value="" disabled>Escolha outra conta</option><ReferenceOptions rows={accounts}/></select></label>}
    <label className="block text-sm">Categoria<select aria-label="Categoria" name="categoryId" defaultValue={draft.categoryId || categories[0]?.id || ''} className={selectClass} required><option value="" disabled>Escolha uma categoria</option><ReferenceOptions rows={categories}/></select></label>
  </>;
}
function DateFields({draft,kind,status,onStatus}:{draft:Draft;kind:string;status:Draft['status'];onStatus:(value:Draft['status'])=>void}) {
  return <><div className="grid grid-cols-2 gap-3"><label className="block text-sm">{kind==='expense'?'Data do gasto *':'Data da compra *'}<Input name="purchaseDate" type="date" defaultValue={draft.purchaseDate} required/></label><label className="block text-sm">Competência<Input name="competenceMonth" type="month" defaultValue={draft.competenceMonth} required/></label></div>
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Vencimento<Input name="dueDate" type="date" defaultValue={draft.dueDate}/></label><label className="block text-sm">Status<select aria-label="Status" name="status" value={status} onChange={e=>onStatus(e.target.value as Draft['status'])} className={selectClass}><option value="planned">Previsto</option><option value="recorded">Registrado</option><option value="settled">Liquidado</option><option value="cancelled">Cancelado</option></select></label></div>
    {status==='settled' && <label className="block text-sm">Data de pagamento<Input name="paidDate" type="date" defaultValue={draft.paidDate} required/></label>}
  </>;
}
function SubmitButtons({pending,missing,kind,onClose}:{pending:boolean;missing:boolean;kind:string;onClose:()=>void}) {
  return <div className="flex justify-end gap-3"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancelar</Button><Button type="submit" disabled={pending || missing}>{pending?'Salvando…':kind==='expense'?'Salvar Gasto':'Salvar lançamento'}</Button></div>;
}
