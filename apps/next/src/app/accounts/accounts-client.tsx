'use client';
import { useRef,useState,type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { civilToday,formatCents,type ManualAccountRecord,type ManualCategoryRecord } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card,CardContent } from '@/components/ui/card';
import { FinanceDialog } from '@/components/finance-dialog';
import { saveFinance } from '@/lib/finance-client';
type Selected={kind:'account';row:ManualAccountRecord|null}|{kind:'category';row:ManualCategoryRecord|null};
export default function AccountsClient({initialAccounts,initialCategories}:{initialAccounts:ManualAccountRecord[];initialCategories:ManualCategoryRecord[]}) {
  const router=useRouter(),keys=useRef(new Map<string,string>());
  const [selected,setSelected]=useState<Selected|null>(null),[showArchived,setShowArchived]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const accounts=initialAccounts.filter(row=>showArchived || !row.archivedAt).toSorted((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name));
  const categories=initialCategories.filter(row=>showArchived || !row.archivedAt).toSorted((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name));
  const active=initialAccounts.filter(row=>!row.archivedAt),incomplete=active.some(row=>row.balance===null);
  const total=active.reduce((sum,row)=>sum+(row.balance===null?0n:BigInt(row.balance.replace('.',''))),0n);
  async function archive(kind:'accounts'|'categories',row:ManualAccountRecord|ManualCategoryRecord) {
    const action=row.archivedAt?'restore':'archive',identity=kind+row.id+row.revision+action;
    if(!keys.current.has(identity))keys.current.set(identity,crypto.randomUUID());
    setBusy(true);setError('');
    try {await saveFinance('/api/'+kind+'/'+row.id,'POST',{action},keys.current.get(identity)!,row.revision);router.refresh();}
    catch(e) {setError(e instanceof Error?e.message:'Falha ao salvar.');}finally{setBusy(false);}
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Contas e categorias</h1><p className="text-sm text-muted">Seu saldo inicial e movimentos liquidados, sem conexão bancária obrigatória.</p></div><Button onClick={()=>setSelected({kind:'account',row:null})}>Nova conta</Button></div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <Card><CardContent className="p-6"><p className="text-sm text-muted">Saldo consolidado de contas ativas</p><p className="text-3xl font-bold">{incomplete?'Saldo incompleto':formatCents(total)}</p>{incomplete && <p className="text-sm text-muted">Defina um saldo inicial datado nas contas sem saldo disponível.</p>}</CardContent></Card>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>Mostrar contas e categorias arquivadas</label>
    <section aria-label="Contas" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.length===0 && <p className="text-muted">Crie sua primeira conta ou carteira para começar.</p>}
      {accounts.map(row=><Card key={row.id}><CardContent className="space-y-3 p-5"><h2 className="font-semibold break-words" style={{borderLeft:'4px solid '+row.color,paddingLeft:8}}>{row.name}</h2><p className="text-sm text-muted">{row.type==='carteira'?'Carteira':'Conta bancária'}{row.archivedAt?' · Arquivada':''}</p><p className="text-xl font-semibold">{row.balance===null?'Defina o saldo inicial':formatCents(BigInt(row.balance.replace('.','')))}</p><p className="text-xs text-muted">Saldo inicial: {formatCents(BigInt(row.openingBalance.replace('.','')))}{row.openingDate?' em '+row.openingDate:''}</p><div className="flex gap-2"><Button variant="outline" aria-label={'Editar '+row.name} onClick={()=>setSelected({kind:'account',row})}>Editar</Button><Button variant="ghost" disabled={busy} aria-label={(row.archivedAt?'Restaurar ':'Arquivar ')+row.name} onClick={()=>archive('accounts',row)}>{row.archivedAt?'Restaurar':'Arquivar'}</Button></div></CardContent></Card>)}
    </section>
    <section aria-label="Categorias" className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Categorias</h2><Button variant="outline" onClick={()=>setSelected({kind:'category',row:null})}>Nova categoria</Button></div>
      {categories.length===0 && <p className="text-muted">Crie uma categoria para classificar seus lançamentos.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">{categories.map(row=><li key={row.id} className="rounded-xl border border-border p-4"><h3 className="font-semibold break-words" style={{borderLeft:'4px solid '+row.color,paddingLeft:8}}>{row.name}{row.archivedAt?' · Arquivada':''}</h3><div className="mt-3 flex gap-2"><Button variant="outline" aria-label={'Editar categoria '+row.name} onClick={()=>setSelected({kind:'category',row})}>Editar</Button><Button variant="ghost" disabled={busy} aria-label={(row.archivedAt?'Restaurar':'Arquivar')+' categoria '+row.name} onClick={()=>archive('categories',row)}>{row.archivedAt?'Restaurar':'Arquivar'}</Button></div></li>)}</ul>
    </section>
    {selected && <CatalogForm selected={selected} onClose={()=>setSelected(null)} onSaved={()=>{setSelected(null);router.refresh();}}/>}
  </div>;
}
function CatalogForm({selected,onClose,onSaved}:{selected:Selected;onClose:()=>void;onSaved:()=>void}) {
  const key=useRef(''),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [today]=useState(()=>civilToday(new Date()));
  const row=selected.row,account=selected.kind==='account',title=(row?'Editar ':'Nova ')+(account?'conta':'categoria');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget),text=(name:string)=>String(form.get(name)??'');
    const input=account?{name:text('name'),type:text('type'),openingBalance:text('openingBalance').trim().replace(',','.'),openingDate:text('openingDate'),color:text('color'),sortOrder:Number(text('sortOrder'))}:{name:text('name'),color:text('color'),icon:text('icon'),sortOrder:Number(text('sortOrder'))};
    if(!key.current)key.current=crypto.randomUUID();setPending(true);setError('');
    try {await saveFinance('/api/'+(account?'accounts':'categories')+(row?'/'+row.id:''),row?'PATCH':'POST',input,key.current,row?.revision);onSaved();}catch(e){setError(e instanceof Error?e.message:'Falha ao salvar.');}finally{setPending(false);}
  }
  return <FinanceDialog title={title} onClose={onClose} busy={pending}><form onSubmit={submit} className="space-y-4">
    {error && <p role="alert" className="text-danger text-sm">{error}</p>}
    <label className="block text-sm">Nome<Input name="name" defaultValue={row?.name??''} maxLength={120} required/></label>
    {account && <><label className="block text-sm">Tipo<select name="type" defaultValue={(row as ManualAccountRecord)?.type??'banco'} className="w-full rounded-xl border border-border bg-surface p-2"><option value="banco">Conta bancária</option><option value="carteira">Carteira</option></select></label><label className="block text-sm">Saldo inicial (R$)<Input name="openingBalance" inputMode="decimal" defaultValue={(row as ManualAccountRecord)?.openingBalance??'0.00'} required/></label><label className="block text-sm">Data do saldo inicial<Input name="openingDate" type="date" defaultValue={(row as ManualAccountRecord)?.openingDate??today} required/></label><p className="text-xs text-muted">O saldo inicial representa o início desse dia. Movimentos liquidados a partir dessa data entram no saldo.</p></>}
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm">Cor<Input name="color" type="color" defaultValue={row?.color??'#64748b'} required/></label><label className="block text-sm">Ordem<Input name="sortOrder" type="number" min="0" max="100000" defaultValue={row?.sortOrder??0} required/></label></div>
    {!account && <label className="block text-sm">Ícone<Input name="icon" defaultValue={(row as ManualCategoryRecord)?.icon??'tag'} maxLength={60} required/></label>}
    <div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button><Button type="submit" disabled={pending}>{pending?'Salvando…':'Salvar'}</Button></div>
  </form></FinanceDialog>;
}
