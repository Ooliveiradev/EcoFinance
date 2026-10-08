'use client';
import { useState } from 'react';
import type { ImportBatchView, ImportMapping } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';

const fieldClass = 'w-full min-w-0 rounded-lg border border-border bg-surface p-2 text-sm';
function letter(index: number) {
  let column = index + 1, label = '';
  while (column > 0) { label = String.fromCharCode(65 + (column - 1) % 26) + label; column = Math.floor((column - 1) / 26); }
  return label;
}
type Apply = (input: { mapping: ImportMapping; remember: boolean }) => Promise<void>;
/** Assisted mapping for CSV/TSV and spreadsheets whose layout or values are ambiguous. */
export function ImportMappingForm({ batch, busy, onApply }: { batch: ImportBatchView; busy: boolean; onApply: Apply }) {
  const layout = batch.layout!;
  const [draft, setDraft] = useState<ImportMapping>(batch.mapping ?? layout.suggestion);
  const [remember, setRemember] = useState(true);
  const sheet = layout.sheets.find(s => s.name === (draft.sheet ?? '')) ?? layout.sheets[0]!;
  const header = sheet.sample.find(row => row.line === draft.headerRow);
  const columns = Array.from({ length: sheet.columns }, (_, index) => ({ index, label: letter(index) + (header?.cells[index] ? ' · ' + header.cells[index] : '') }));
  const split = draft.amount === null;
  const patch = (value: Partial<ImportMapping>) => setDraft(current => ({ ...current, ...value }));
  const select = (label: string, key: 'date' | 'description' | 'amount' | 'debit' | 'credit') => <label className="text-sm">{label}
    <select aria-label={label} className={fieldClass} value={draft[key] ?? 0} onChange={e => patch({ [key]: Number(e.target.value) })}>{columns.map(c => <option key={c.index} value={c.index}>{c.label}</option>)}</select>
  </label>;
  return <details className="rounded-xl border border-border p-3" open={batch.state === 'failed'}>
    <summary className="cursor-pointer font-semibold">Mapeamento de colunas{batch.state === 'review' ? ' (alterar)' : ' necessário'}</summary>
    <div className="mt-3 space-y-3 min-w-0">
      {layout.reasons.map(reason => <p key={reason} role="status" className="text-sm text-danger">{reason}</p>)}
      <div className="overflow-x-auto max-w-full"><table aria-label={'Amostra de ' + batch.filename} className="text-xs border-collapse">
        <thead><tr><th className="p-1 text-left">Linha</th>{columns.slice(0, 20).map(c => <th key={c.index} className="p-1 text-left">{letter(c.index)}</th>)}</tr></thead>
        <tbody>{sheet.sample.map(row => <tr key={row.line} className={row.line === draft.headerRow ? 'font-semibold' : ''}><td className="p-1">{row.line}</td>{columns.slice(0, 20).map(c => <td key={c.index} className="p-1 whitespace-nowrap">{row.cells[c.index] ?? ''}</td>)}</tr>)}</tbody>
      </table></div>
      <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); void onApply({ mapping: draft, remember }); }}>
        {layout.kind === 'spreadsheet' && layout.sheets.length > 1 && <label className="text-sm">Aba da planilha
          <select aria-label="Aba da planilha" className={fieldClass} value={sheet.name} onChange={e => { const next = layout.sheets.find(s => s.name === e.target.value)!; patch({ sheet: next.name, headerRow: next.headerRow }); }}>{layout.sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select>
        </label>}
        <label className="text-sm">Linha do cabeçalho
          <select aria-label="Linha do cabeçalho" className={fieldClass} value={draft.headerRow} onChange={e => patch({ headerRow: Number(e.target.value) })}><option value={0}>Sem cabeçalho</option>{sheet.sample.map(row => <option key={row.line} value={row.line}>Linha {row.line}</option>)}</select>
        </label>
        {select('Coluna da data', 'date')}
        {select('Coluna da descrição', 'description')}
        <label className="text-sm">Valores
          <select aria-label="Forma dos valores" className={fieldClass} value={split ? 'split' : 'single'} onChange={e => patch(e.target.value === 'split' ? { amount: null, debit: draft.debit ?? draft.amount ?? 0, credit: draft.credit ?? Math.min(sheet.columns - 1, (draft.amount ?? 0) + 1) } : { amount: draft.debit ?? 0, debit: null, credit: null })}>
            <option value="single">Uma coluna com sinal</option><option value="split">Colunas de débito e crédito</option>
          </select>
        </label>
        {split ? <>{select('Coluna do débito', 'debit')}{select('Coluna do crédito', 'credit')}</> : select('Coluna do valor', 'amount')}
        <label className="text-sm">Ordem das datas
          <select aria-label="Ordem das datas" className={fieldClass} value={draft.dateOrder ?? ''} onChange={e => patch({ dateOrder: (e.target.value || null) as ImportMapping['dateOrder'] })}><option value="">Detectar pelos dados</option><option value="dmy">DD/MM/AAAA</option><option value="mdy">MM/DD/AAAA</option><option value="ymd">AAAA-MM-DD</option></select>
        </label>
        <label className="text-sm">Separador decimal
          <select aria-label="Separador decimal" className={fieldClass} value={draft.decimal ?? ''} onChange={e => patch({ decimal: (e.target.value || null) as ImportMapping['decimal'] })}><option value="">Detectar pelos dados</option><option value=",">Vírgula (1.234,56)</option><option value=".">Ponto (1,234.56)</option></select>
        </label>
        <label className="text-sm flex items-center gap-3"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Salvar mapeamento para este layout</label>
        <Button type="submit" disabled={busy}>Aplicar mapeamento</Button>
      </form>
      <p className="text-xs text-muted">{batch.state === 'review' ? 'Aplicar cria um novo lote em revisão e cancela este, sem alterar saldos.' : 'Nenhum saldo é alterado; as linhas aparecem para revisão após o mapeamento.'}</p>
    </div>
  </details>;
}
