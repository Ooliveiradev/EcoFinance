'use client';
import { useImports } from './use-imports';
import { Button } from '@/components/ui/button';
import { ImportReview } from './import-review';
export interface ImportReference { id: string; name: string }
export interface ImportHistory { id: string; filename: string; state: string; format: string;createdAt?:string }
export interface ImportsClientProps { accounts: ImportReference[]; cards: ImportReference[]; categories: ImportReference[]; recentBatches: ImportHistory[]; error?: string }
const labels: Record<string, string> = { received: 'Recebido', processing: 'Processando', review: 'Em revisão', confirmed: 'Confirmado', failed: 'Falhou', cancelled: 'Cancelado', reverted: 'Revertido' };
const receivedTime=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Sao_Paulo'});
export default function ImportsClient({ accounts, cards, categories, recentBatches, error: initialError }: ImportsClientProps) {
  const controller = useImports({ accounts, cards, categories, recentBatches, error: initialError });
  const { files, target, batches, history, hasMore, busy, error, message, guarded, read, mutate, upload, moreHistory, setFiles, setTarget } = controller;
  return <div className="space-y-6 max-w-6xl mx-auto">
    <header><h1 className="text-2xl font-bold">Importações</h1><p className="text-muted mt-2">Carregue arquivos, revise cada linha e confirme os itens selecionados.</p></header>
    {error && <p role="alert" className="rounded-xl bg-danger-soft text-danger p-4">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-success-soft text-success p-4">{message}</p>}
    <form className="rounded-2xl border border-border bg-surface p-4 space-y-4" onSubmit={e => { e.preventDefault(); void guarded(upload); }}>
      <label className="block">Conta ou cartão de destino<select aria-label="Conta ou cartão de destino" value={target} disabled={busy} onChange={e => setTarget(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-surface p-3"><option value="">Escolha o destino</option><optgroup label="Contas">{accounts.map(a => <option key={a.id} value={'account:' + a.id}>{a.name}</option>)}</optgroup><optgroup label="Cartões">{cards.map(c => <option key={c.id} value={'card:' + c.id}>{c.name}</option>)}</optgroup></select></label>
      <label className="block">Arquivos para revisão<input aria-label="Arquivos para revisão" key={controller.uploadVersion} type="file" multiple disabled={busy} onChange={e => setFiles(Array.from(e.target.files ?? []))} className="block w-full mt-2 border border-border rounded-xl p-3" /></label>
      <p className="text-sm text-muted">OFX/QFX e CSV/TSV em UTF-8. A detecção usa o conteúdo e verifica o MIME; a extensão é uma pista. Até 10 arquivos, 256 KiB, 60 linhas e seis competências por arquivo. Planilhas binárias e PDF exibem orientação para conversão.</p>
      <p className="text-sm">CSV/TSV: colunas data, descrição e valor; despesas negativas. Nenhum saldo é alterado no upload ou na revisão. Em cartões, valores positivos são créditos e compras não representam pagamento da fatura.</p>
      {files.length > 0 && <ul aria-label="Arquivos selecionados" className="text-sm">{files.map(entry => <li key={entry.id}>{entry.file.name} · {entry.file.size} bytes</li>)}</ul>}
      <Button type="submit" disabled={busy || !target || !files.length}>{busy ? 'Processando arquivos…' : 'Carregar e analisar'}</Button>
    </form>
    <section aria-label="Lotes para revisão" className="space-y-6">{batches.map(batch => <article key={batch.id} aria-label={'Lote ' + batch.filename} className="rounded-2xl border border-border bg-surface p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-bold break-all">{batch.filename}</h2><p className="text-sm text-muted">{batch.format} · {labels[batch.state] ?? batch.state} · {batch.cardId ? cards.find(c => c.id === batch.cardId)?.name : accounts.find(a => a.id === batch.accountId)?.name} · {batch.period ?? 'Período a identificar'}</p></div><progress aria-label={'Progresso de ' + batch.filename} value={batch.state === 'received' ? 0 : batch.state === 'processing' ? 1 : 2} max={2} /></div>
      {batch.error && <p role="alert" className="text-danger">{batch.error}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void guarded(async () => { await read(batch.id); })}>Recarregar lote</Button>
        {['received', 'processing', 'failed'].includes(batch.state) && <Button disabled={busy} onClick={() => void guarded(() => mutate(batch, 'process'))}>{batch.state === 'received' ? 'Analisar arquivo' : 'Repetir análise'}</Button>}
        {['received', 'processing', 'failed', 'review'].includes(batch.state) && <Button variant="outline" disabled={busy} onClick={() => void guarded(() => mutate(batch, 'cancel'))}>Cancelar lote</Button>}
        {batch.state === 'confirmed' && <Button variant="outline" disabled={busy} onClick={() => void guarded(() => mutate(batch, 'undo', { confirmed: true }))}>Desfazer lote</Button>}
        {['review','confirmed','cancelled','reverted'].includes(batch.state) && <Button variant="outline" disabled={busy} onClick={() => void guarded(() => mutate(batch, 'repeat'))}>Repetir lote</Button>}
      </div>
      <ImportReview batch={batch} categories={categories} busy={busy} dirty={batch.rows.some(r => controller.dirtyRows[r.id] === r.revision)} onDirty={controller.markDirty} onSave={(item, input) => guarded(() => mutate(batch, 'review', input, item))} onConfirm={() => guarded(() => mutate(batch, 'confirm', { confirmed: true }))} />
    </article>)}</section>
    <section aria-label="Histórico de importações" className="rounded-2xl border border-border p-4 space-y-3"><h2 className="font-bold">Histórico de importações</h2>{history.length === 0 && <p className="text-muted">Nenhum arquivo recebido.</p>}{history.map(b => <div key={b.id} className="flex flex-wrap justify-between items-center gap-2 border-b border-border py-2"><span className="break-all text-sm">{b.filename} · {b.format} · {labels[b.state] ?? b.state}{b.createdAt && <time className="block text-xs text-muted" dateTime={b.createdAt}>Recebido em {receivedTime.format(new Date(b.createdAt))}</time>}</span><Button variant="outline" disabled={busy} onClick={() => void guarded(async () => { await read(b.id); })}>Abrir lote</Button></div>)}{hasMore && <Button variant="outline" disabled={busy} onClick={() => void guarded(moreHistory)}>Mais importações</Button>}</section>
  </div>;
}
