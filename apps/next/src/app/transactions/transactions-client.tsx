'use client';
import { useRef,useState,useTransition,type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { formatCents,moneyToCents,type ManualAccountRecord,type ManualCategoryRecord,type ManualEntryRecord,type ManualList } from '@ecofinance/shared';
import { EntryDialog } from '@/components/entry-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveFinance } from '@/lib/finance-client';
export default function TransactionsClient({initialData,query,hasMore,accounts,categories}:{initialData:ManualEntryRecord[];query:ManualList;hasMore:boolean;accounts:ManualAccountRecord[];categories:ManualCategoryRecord[]}) {
  const router=useRouter(),keys=useRef(new Map<string,string>());
  const [editing,setEditing]=useState<ManualEntryRecord|null|undefined>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[undo,setUndo]=useState<{id:string;revision:string}|null>(null),[navigating,startTransition]=useTransition();
  function navigate(values:Record<string,unknown>) {
    const params=new URLSearchParams();
    for(const [key,value]of Object.entries(values))if(value!==undefined && value!=='')params.set(key,String(value));
    startTransition(()=>router.push('/transactions?'+params));
  }
  function filter(event:FormEvent<HTMLFormElement>) {event.preventDefault();navigate({...Object.fromEntries(new FormData(event.currentTarget)),page:1});}
  async function archive(row:{id:string;revision:string},restore=false) {
    const identity=row.id+row.revision+String(restore);
    if(!keys.current.has(identity))keys.current.set(identity,crypto.randomUUID());
    setBusy(true);setError('');
    try {const result=await saveFinance('/api/entries/'+row.id,restore?'POST':'DELETE',{action:restore?'restore':'archive'},keys.current.get(identity)!,row.revision);setUndo(restore?null:result);router.refresh();}
    catch(e){setError(e instanceof Error?e.message:'Falha ao salvar.');}finally{setBusy(false);}
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Lançamentos</h1><p className="text-sm text-muted">Receitas, despesas e transferências entre suas contas.</p></div><Button onClick={()=>setEditing(null)}>Novo lançamento</Button></div>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {undo && <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"><span>Lançamento excluído. O histórico foi preservado.</span><Button variant="outline" disabled={busy} onClick={()=>archive(undo,true)}>Desfazer exclusão</Button></div>}
    <EntryFilters accounts={accounts} categories={categories} query={query} navigating={navigating} onSubmit={filter} onClear={()=>navigate({})}/>
    <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><caption className="sr-only">Lançamentos financeiros da página {query.page}</caption><thead className="bg-surface-muted"><tr><th className="p-3">Compra</th><th className="p-3">Descrição</th><th className="p-3">Conta e categoria</th><th className="p-3">Tipo e status</th><th className="p-3">Valor</th><th className="p-3">Ações</th></tr></thead><tbody>
      {initialData.length===0 && <tr><td colSpan={6} className="p-8 text-muted">Nenhum lançamento neste filtro.</td></tr>}
      {initialData.map(row=><tr key={row.id} className="border-t border-border"><td className="p-3 whitespace-nowrap">{row.purchaseDate.split('-').reverse().join('/')}</td><td className="p-3"><p className="font-medium">{row.description}</p>{row.notes && <p className="mt-1 max-w-xs text-xs text-muted break-words">{row.notes}</p>}</td><td className="p-3"><p>{row.accountName}</p><p className="text-xs text-muted">{row.categoryName}</p></td><td className="p-3"><p>{{income:'Receita',expense:'Despesa',transfer:'Transferência',refund:'Estorno',adjustment:'Ajuste',unclassified:'A classificar'}[row.kind]??row.kind}</p><p className="text-xs text-muted">{{planned:'Previsto',recorded:'Registrado',settled:'Liquidado',cancelled:'Cancelado'}[row.status]}</p></td><td className="p-3 font-semibold whitespace-nowrap">{formatCents(moneyToCents(row.amount))}</td><td className="p-3"><div className="flex gap-2">{row.archivedAt?<Button variant="outline" disabled={busy} onClick={()=>archive(row,true)}>Restaurar {row.description}</Button>:<><Button variant="outline" onClick={()=>setEditing(row)}>Editar {row.description}</Button><Button variant="ghost" disabled={busy} onClick={()=>archive(row)}>Excluir {row.description}</Button></>}</div></td></tr>)}
    </tbody></table></div>
    <nav aria-label="Paginação de lançamentos" className="flex items-center justify-between gap-3"><Button variant="outline" disabled={query.page===1 || navigating} onClick={()=>navigate({...query,page:query.page-1})}>Anterior</Button><span>Página {query.page}</span><Button variant="outline" disabled={!hasMore || navigating} onClick={()=>navigate({...query,page:query.page+1})}>Próxima</Button></nav>
    {editing!==undefined && <EntryDialog accounts={accounts} categories={categories} initial={editing??undefined} onClose={()=>setEditing(undefined)} onSaved={()=>{setEditing(undefined);setUndo(null);router.refresh();}}/>}
  </div>;
}


function EntryFilters({query,navigating,onSubmit,onClear,accounts,categories}:{accounts:ManualAccountRecord[];categories:ManualCategoryRecord[];query:ManualList;navigating:boolean;onSubmit:(event:FormEvent<HTMLFormElement>)=>void;onClear:()=>void}) {
  return (
    <form key={JSON.stringify(query)} onSubmit={onSubmit} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtros de lançamentos">
      <label className="text-sm">Descrição<Input name="description" defaultValue={query.description??''} maxLength={120}/></label>
      <label className="text-sm">Conta<select name="accountId" defaultValue={query.accountId??''} className="w-full rounded-xl border border-border bg-surface p-2"><option value="">Todas as contas</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-sm">Categoria<select name="categoryId" defaultValue={query.categoryId??''} className="w-full rounded-xl border border-border bg-surface p-2"><option value="">Todas as categorias</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="text-sm">Tipo<select name="kind" defaultValue={query.kind??''} className="w-full rounded-xl border border-border bg-surface p-2"><option value="">Todos os tipos</option><option value="income">Receita</option><option value="expense">Despesa</option><option value="transfer">Transferência</option><option value="refund">Estorno</option><option value="adjustment">Ajuste</option><option value="unclassified">A classificar</option></select></label>
      <label className="text-sm">Status<select name="status" defaultValue={query.status??''} className="w-full rounded-xl border border-border bg-surface p-2"><option value="">Todos os status</option><option value="planned">Previsto</option><option value="recorded">Registrado</option><option value="settled">Liquidado</option><option value="cancelled">Cancelado</option></select></label>
      <label className="text-sm">Compra desde<Input name="startDate" type="date" defaultValue={query.startDate??''}/></label><label className="text-sm">Compra até<Input name="endDate" type="date" defaultValue={query.endDate??''}/></label>
      <label className="text-sm">Competência<Input name="competenceMonth" type="month" defaultValue={query.competenceMonth?.slice(0,7)??''}/></label>
      <label className="text-sm">Exibição<select name="archived" defaultValue={query.archived} className="w-full rounded-xl border border-border bg-surface p-2"><option value="false">Ativos</option><option value="true">Excluídos</option></select></label>
      <input type="hidden" name="limit" value={query.limit}/><div className="flex items-end gap-2"><Button type="submit" disabled={navigating}>Aplicar filtros</Button><Button type="button" variant="outline" onClick={onClear} disabled={navigating}>Limpar</Button></div>
    </form>
  );
}
