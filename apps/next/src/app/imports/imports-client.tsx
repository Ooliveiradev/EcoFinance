'use client';
import { useState } from 'react';
import type { ImportBatchView } from '@ecofinance/shared';
import { useImports } from './use-imports';
import { Button } from '@/components/ui/button';
import { ImportReview } from './import-review';
import { ImportMappingForm } from './import-mapping';
export interface ImportReference { id: string; name: string }
export interface ImportHistory { id: string; filename: string; state: string; format: string;createdAt?:string }
export interface ImportsClientProps { accounts: ImportReference[]; cards: ImportReference[]; categories: ImportReference[]; recentBatches: ImportHistory[]; error?: string }
const labels: Record<string, string> = { received: 'Recebido', processing: 'Processando', review: 'Em revisão', confirmed: 'Confirmado', failed: 'Falhou', cancelled: 'Cancelado', reverted: 'Revertido' };
const receivedTime=new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium',timeZone:'America/Sao_Paulo'});
function progressText(batch: ImportBatchView) {
  if (batch.state !== 'processing') return null;
  if (!batch.progress) return 'Analisando o arquivo…';
  return `Lendo página ${batch.progress.page} de ${batch.progress.pages}${batch.progress.stage === 'ocr' ? ' por leitura óptica (OCR)' : ''}…`;
}
/** Shown when a PDF is protected; the password goes only to this analysis. */
function PasswordForm({ batch, busy, onSubmit }: { batch: ImportBatchView; busy: boolean; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  return <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); const value = password; setPassword(''); void onSubmit(value); }}>
    <label className="text-sm">Senha do PDF<input aria-label={'Senha do PDF ' + batch.filename} type="password" autoComplete="off" required maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} className="mt-1 block rounded-lg border border-border bg-surface p-2" /></label>
    <Button type="submit" disabled={busy || !password}>Analisar com a senha</Button>
    <p className="w-full text-xs text-muted">A senha é usada só nesta análise e não é guardada nem registrada.</p>
  </form>;
}
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
      <p className="text-sm text-muted">OFX/QFX (SGML ou XML), CSV/TSV (UTF-8, UTF-16 ou Windows-1252), planilhas XLS/XLSX, PDF digital ou escaneado (até 10 páginas) e fotos PNG, JPEG ou WebP de extratos, faturas e comprovantes. A detecção usa o conteúdo e verifica o MIME; a extensão é uma pista. Até 10 arquivos, 256 KiB, 60 linhas e seis competências por arquivo; fotos maiores são reduzidas antes do envio. Fórmulas e macros nunca são executadas. A leitura óptica (OCR) roda no servidor do EcoFinance, sem serviço externo.</p>
      <p className="text-sm">CSV/TSV e planilhas: colunas de data, descrição e valor (ou débito e crédito); despesas negativas. Layouts desconhecidos e datas ambíguas pedem mapeamento, que pode ser salvo. Nenhum saldo é alterado no upload ou na revisão. Em cartões, valores positivos são créditos e compras não representam pagamento da fatura.</p>
      {files.length > 0 && <ul aria-label="Arquivos selecionados" className="text-sm">{files.map(entry => <li key={entry.id}>{entry.file.name} · {entry.file.size} bytes{entry.reducedFrom && ` · foto reduzida de ${entry.reducedFrom} bytes para o envio`}</li>)}</ul>}
      <Button type="submit" disabled={busy || !target || !files.length}>{busy ? 'Processando arquivos…' : 'Carregar e analisar'}</Button>
    </form>
    <section aria-label="Lotes para revisão" className="space-y-6">{batches.map(batch => <article key={batch.id} aria-label={'Lote ' + batch.filename} className="rounded-2xl border border-border bg-surface p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h2 className="font-bold break-all">{batch.filename}</h2><p className="text-sm text-muted">{batch.format} · {labels[batch.state] ?? batch.state} · {batch.cardId ? cards.find(c => c.id === batch.cardId)?.name : accounts.find(a => a.id === batch.accountId)?.name} · {batch.period ?? 'Período a identificar'}</p></div><progress aria-label={'Progresso de ' + batch.filename} value={batch.state === 'received' ? 0 : batch.state === 'processing' ? 1 + (batch.progress ? (batch.progress.page - 1) / batch.progress.pages : 0) : 2} max={2} /></div>
      {progressText(batch) && <p role="status" className="text-sm text-muted">{progressText(batch)}</p>}
      {batch.error && <p role="alert" className="text-danger">{batch.error}</p>}
      {batch.state === 'failed' && (batch.errorCode === 'PASSWORD_REQUIRED' || batch.errorCode === 'PASSWORD_INVALID') && <PasswordForm batch={batch} busy={busy} onSubmit={password => guarded(() => mutate(batch, 'process', { password }))} />}
      {batch.layout && ['failed', 'review'].includes(batch.state) && <ImportMappingForm key={batch.revision} batch={batch} busy={busy} onApply={input => guarded(() => mutate(batch, 'map', input))} />}
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void guarded(async () => { await read(batch.id); })}>Recarregar lote</Button>
        {['received', 'processing', 'failed'].includes(batch.state) && <Button disabled={busy} onClick={() => void guarded(() => mutate(batch, 'process'))}>{batch.state === 'received' ? 'Analisar arquivo' : 'Repetir análise'}</Button>}
        {batch.state === 'processing' && <Button variant="outline" onClick={() => void controller.cancelProcessing(batch)}>Cancelar análise</Button>}
        {['received', 'failed', 'review'].includes(batch.state) && <Button variant="outline" disabled={busy} onClick={() => void guarded(() => mutate(batch, 'cancel'))}>Cancelar lote</Button>}
        {batch.state === 'confirmed' && <Button variant="outline" disabled={busy} onClick={() => void guarded(() => mutate(batch, 'undo', { confirmed: true }))}>Desfazer lote</Button>}
        {['review','confirmed','cancelled','reverted'].includes(batch.state) && <Button variant="outline" disabled={busy} onClick={() => void guarded(() => mutate(batch, 'repeat'))}>Repetir lote</Button>}
      </div>
      <ImportReview batch={batch} categories={categories} busy={busy} dirty={batch.rows.some(r => controller.dirtyRows[r.id] === r.revision)} onDirty={controller.markDirty} onSave={(item, input) => guarded(() => mutate(batch, 'review', input, item))} onConfirm={() => guarded(() => mutate(batch, 'confirm', { confirmed: true }))} />
    </article>)}</section>
    <section aria-label="Histórico de importações" className="rounded-2xl border border-border p-4 space-y-3"><h2 className="font-bold">Histórico de importações</h2>{history.length === 0 && <p className="text-muted">Nenhum arquivo recebido.</p>}{history.map(b => <div key={b.id} className="flex flex-wrap justify-between items-center gap-2 border-b border-border py-2"><span className="break-all text-sm">{b.filename} · {b.format} · {labels[b.state] ?? b.state}{b.createdAt && <time className="block text-xs text-muted" dateTime={b.createdAt}>Recebido em {receivedTime.format(new Date(b.createdAt))}</time>}</span><Button variant="outline" disabled={busy} onClick={() => void guarded(async () => { await read(b.id); })}>Abrir lote</Button></div>)}{hasMore && <Button variant="outline" disabled={busy} onClick={() => void guarded(moreHistory)}>Mais importações</Button>}</section>
  </div>;
}
