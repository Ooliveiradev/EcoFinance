'use client';
import { useReducer, useState } from 'react';
import { formatCents, type ImportBatchView, type ImportRowView } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import type { ImportReference } from './imports-client';
type Save = (row: ImportRowView, input: unknown) => Promise<void>;
interface Draft { description: string; amount: string; purchaseDate: string; month: string; categoryId: string; selected: boolean; resolution: ImportRowView['resolution']; duplicateId: string }
function initialDraft(row: ImportRowView): Draft {
  return { description: row.description ?? '', amount: row.amount ?? '', purchaseDate: row.purchaseDate ?? '', month: row.competenceMonth?.slice(0, 7) ?? '', categoryId: row.categoryId ?? '', selected: row.selected, resolution: row.resolution, duplicateId: row.duplicateId ?? '' };
}
const patchDraft = (draft: Draft, patch: Partial<Draft>): Draft => ({ ...draft, ...patch });
const fieldClass = 'w-full min-w-0 rounded-lg border border-border bg-surface p-2 text-sm';
const rowLabels: Record<string,string> = {pending:'Categoria a revisar',invalid:'Inválida',valid:'Revisada',excluded:'Excluída',committed:'Confirmada'};
export function ImportReview({ batch, categories, busy, dirty, onDirty, onSave, onConfirm }: { batch: ImportBatchView; categories: ImportReference[]; busy: boolean; dirty: boolean; onDirty: (row: ImportRowView) => void; onSave: Save; onConfirm: () => Promise<void> }) {
  if (!batch.rows.length) return null;
  const count = batch.rows.filter(r => r.selected && ['valid','committed'].includes(r.state) && r.resolution !== 'exclude').length;
  return <div className="space-y-4">
    <p className="text-sm text-muted">{count} linha(s) válida(s) selecionada(s) de {batch.rows.length}. Salve cada correção para incluí-la na prévia. Dados originais e avisos permanecem no histórico.</p>
    {batch.rows.map(row => <ImportLine key={row.id + ':' + row.revision} row={row} categories={categories} disabled={busy || batch.state !== 'review'} onDirty={onDirty} onSave={onSave} />)}
    {batch.state === 'review' && <>
      <ImportChart preview={batch.preview} />
      <ConfirmSelection key={batch.revision} busy={busy} dirty={dirty} count={count} onConfirm={onConfirm} />
    </>}
  </div>;
}
function ImportChart({ preview }: { preview: ImportBatchView['preview'] }) {
  return <section aria-label="Prévia dos gráficos" className="rounded-xl bg-surface-muted p-4 space-y-3">
    <h3 className="font-semibold">Prévia dos gráficos por competência</h3>
    <p className="text-sm text-muted">Impacto adicional dos itens salvos para criar. Vínculos e exclusões não adicionam gastos. O saldo atual permanece intacto até confirmar.</p>
    {preview.length === 0 && <p>Nenhuma criação selecionada.</p>}
    {preview.map(p => <div key={p.month} className="space-y-2 text-sm">
      <p>{p.month} · Receitas {formatCents(BigInt(p.income.replace('.', '')))} · Despesas líquidas {formatCents(BigInt(p.expenses.replace('.', '')))} · Impacto no saldo {formatCents(BigInt(p.balance.replace('.', '')))}</p>
      <div className="flex h-4 rounded-md overflow-hidden" role="img" aria-label={'Proporção de receitas e despesas em ' + p.month}>
        <div className="bg-success" style={{ flex: Math.abs(Number(p.income)) }} />
        <div className="bg-danger" style={{ flex: Math.abs(Number(p.expenses)) }} />
      </div>
    </div>)}
  </section>;
}
function ConfirmSelection({ busy, dirty, count, onConfirm }: { busy: boolean; dirty: boolean; count: number; onConfirm: () => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false);
  return <div className="space-y-3">
    {dirty && <p role="status" className="text-sm text-danger">Há correções não salvas. Salve as linhas antes de confirmar.</p>}
    <label className="flex items-start gap-3">
      <input type="checkbox" checked={confirmed} disabled={busy || dirty} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />
      Revisei os itens selecionados, as duplicidades e o destino deste lote.
    </label>
    <Button disabled={busy || dirty || !confirmed || !count} onClick={() => { setConfirmed(false); void onConfirm(); }}>Confirmar itens selecionados</Button>
  </div>;
}
function ImportEvidence({ row }: { row: ImportRowView }) {
  const warnings = [...new Set(row.warnings)];
  return <div className="space-y-3">
    <p className="text-xs text-muted">Origem: {row.provenance.page && `página ${row.provenance.page} · `}linha {row.provenance.row ?? row.position}{row.provenance.cell && ' · célula ' + row.provenance.cell}</p>
    <pre className="text-xs whitespace-pre-wrap break-all max-h-28 overflow-auto">{row.provenance.excerpt}</pre>
    {warnings.length > 0 && <ul className="text-xs text-muted list-disc pl-5">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    {row.undoReason && <p role="status" className="text-sm">{row.undoReason}</p>}
  </div>;
}
function ImportLine({ row, categories, disabled, onDirty, onSave }: { row: ImportRowView; categories: ImportReference[]; disabled: boolean; onDirty: (row: ImportRowView) => void; onSave: Save }) {
  // The parent keys the editor by persisted revision. A successful save remounts
  // only this draft; other rows retain their unsaved corrections.
  const [draft, dispatch] = useReducer(patchDraft, row, initialDraft);
  function change(patch: Partial<Draft>) { dispatch(patch); onDirty(row); }
  function save(event: React.FormEvent) {
    event.preventDefault();
    const { month, ...input } = draft;
    void onSave(row, { ...input, amount: input.amount.replace(',', '.'), competenceMonth: month + '-01', duplicateId: input.duplicateId || null });
  }
  return <details className="border border-border rounded-xl p-3" open={row.state === 'invalid'}>
    <summary className="cursor-pointer text-sm break-words">Linha {row.position} · {row.description ?? 'Sem descrição'} · {row.amount ?? 'Valor inválido'} · {rowLabels[row.state]??row.state} {row.selected && '· Selecionada'}</summary>
    <div className="mt-3 space-y-3">
      <ImportEvidence row={row} />
      <form onSubmit={save} className="space-y-3">
        <fieldset disabled={disabled} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <legend className="sr-only">Revisar linha {row.position}</legend>
          <ImportLineFields draft={draft} position={row.position} categories={categories} change={change} />
          <DuplicateFields draft={draft} row={row} categories={categories} change={change} />
          <label className="text-sm flex items-center gap-3">
            <input aria-label={'Selecionar linha ' + row.position} type="checkbox" checked={draft.selected} onChange={e => change({ selected: e.target.checked })} />Selecionar para confirmar
          </label>
          <Button type="submit" disabled={disabled}>Salvar linha {row.position}</Button>
        </fieldset>
      </form>
    </div>
  </details>;
}
function ImportLineFields({ draft, position, categories, change }: { draft: Draft; position: number; categories: ImportReference[]; change: (patch: Partial<Draft>) => void }) {
  return <>
    <label className="text-sm">Descrição<input aria-label={'Descrição da linha ' + position} required maxLength={500} className={fieldClass} value={draft.description} onChange={e => change({ description: e.target.value })} /></label>
    <label className="text-sm">Valor com sinal (R$)<input aria-label={'Valor da linha ' + position} required inputMode="decimal" className={fieldClass} value={draft.amount} onChange={e => change({ amount: e.target.value })} /></label>
    <label className="text-sm">Data<input aria-label={'Data da linha ' + position} required type="date" className={fieldClass} value={draft.purchaseDate} onChange={e => change({ purchaseDate: e.target.value })} /></label>
    <label className="text-sm">Competência<input aria-label={'Competência da linha ' + position} required type="month" className={fieldClass} value={draft.month} onChange={e => change({ month: e.target.value })} /></label>
    <label className="text-sm">Categoria<select aria-label={'Categoria da linha ' + position} required className={fieldClass} value={draft.categoryId} onChange={e => change({ categoryId: e.target.value })}><option value="">Escolha a categoria</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  </>;
}
function DuplicateFields({ draft, row, categories, change }: { draft: Draft; row: ImportRowView; categories: ImportReference[]; change: (patch: Partial<Draft>) => void }) {
  const names = new Map(categories.map(c => [c.id, c.name]));
  return <>
    <label className="text-sm">Tratamento<select aria-label={'Tratamento da linha ' + row.position} className={fieldClass} value={draft.resolution} onChange={e => change({ resolution: e.target.value as Draft['resolution'] })}>
      <option value="new">Criar (identidade já importada será vinculada)</option><option value="link">Vincular a lançamento existente</option><option value="exclude">Excluir da confirmação</option>
    </select></label>
    {draft.resolution === 'link' && <label className="text-sm sm:col-span-2">Lançamento existente<select aria-label={'Duplicata da linha ' + row.position} required className={fieldClass} value={draft.duplicateId} onChange={e => change({ duplicateId: e.target.value })}>
      <option value="">Escolha e confira os dados</option>{row.candidates.map(c => <option key={c.id} value={c.id}>{c.description} · {c.amount} · {c.purchaseDate} · {names.get(c.categoryId ?? '') ?? 'Categoria indisponível'} · {c.competenceMonth} · {c.archived?'Arquivado':c.status} · {c.exact ? 'mesma identidade' : 'semelhança'}</option>)}
    </select></label>}
  </>;
}
