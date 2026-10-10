'use client';
import { useCallback, useEffect, useState } from 'react';
import type { CategoryRule } from '@ecofinance/shared';

/**
 * Category rules (#11): learned from import reviews or written here. They only
 * pre-select a category during review; nothing is categorized without saving a row.
 */
interface Category { id: string; name: string; archivedAt?: string | null }
interface RulesState { rules: CategoryRule[]; assistant: { model: string } | null }
async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : failure.message ?? 'Não foi possível salvar. Tente novamente.');
  }
}
const button = 'rounded bg-slate-700 px-4 py-2 disabled:opacity-50';
export function CategoryRules() {
  const [state, setState] = useState<RulesState | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pattern, setPattern] = useState(''), [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    const [rules, list] = await Promise.all([fetch('/api/category-rules', { cache: 'no-store' }), fetch('/api/categories', { cache: 'no-store' })]);
    if (!rules.ok || !list.ok) throw new Error(rules.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível carregar as regras de categoria.');
    setState(await rules.json()); setCategories(((await list.json()).categories as Category[]).filter(c => !c.archivedAt));
  }, []);
  useEffect(() => { reload().catch(failure => setError(failure instanceof Error ? failure.message : String(failure))); }, [reload]);
  async function perform(work: () => Promise<void>, done: string) {
    setBusy(true); setError(''); setStatus('');
    try { await work(); await reload(); setStatus(done); return true; } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); return false; } finally { setBusy(false); }
  }
  async function addRule() {
    if (await perform(() => send('/api/category-rules', 'POST', { pattern, categoryId }), 'Regra salva.')) setPattern('');
  }
  const names = new Map(categories.map(c => [c.id, c.name]));
  return <section aria-labelledby="rules-title" className="space-y-4 rounded-xl border border-slate-700 p-4">
    <h2 id="rules-title" className="text-lg font-semibold">Regras de categoria</h2>
    <p className="text-sm text-slate-400">Na revisão de importações, a categoria é pré-selecionada pelas suas regras e só vale ao salvar a linha. As regras aprendidas vêm das categorias que você escolhe na revisão.</p>
    <p className="text-sm text-slate-400">{state?.assistant ? `Linhas sem regra recebem sugestão do modelo local ${state.assistant.model}, executado no servidor desta instalação. Nenhum dado é enviado a serviço externo.` : 'Assistente por modelo local desligado nesta instalação: só suas regras sugerem categorias.'}</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {status && <p role="status" className="text-emerald-400">{status}</p>}
    <form className="flex flex-wrap items-end gap-2" action={addRule}>
      <label className="text-sm">Descrição contém<input aria-label="Descrição contém" value={pattern} onChange={e => setPattern(e.target.value)} required minLength={3} maxLength={80} disabled={busy} className="mt-1 block rounded border border-slate-600 bg-transparent px-2 py-1" /></label>
      <label className="text-sm">Categoria<select aria-label="Categoria da regra" value={categoryId} onChange={e => setCategoryId(e.target.value)} required disabled={busy} className="mt-1 block rounded border border-slate-600 bg-transparent px-2 py-1"><option value="">Escolha</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button type="submit" className={button} disabled={busy || pattern.trim().length < 3 || !categoryId}>Adicionar regra</button>
    </form>
    {state && (state.rules.length ? <ul aria-label="Regras de categoria" className="space-y-1 text-sm">{state.rules.map(rule => <li key={rule.id} className="flex flex-wrap items-center gap-2">
      <span className="break-all">{rule.match === 'contains' ? 'Contém' : 'Igual a'} “{rule.pattern}” → {names.get(rule.categoryId) ?? 'categoria arquivada (sem efeito)'} · {rule.source === 'user' ? 'criada por você' : 'aprendida'}</span>
      <button className="rounded border border-slate-600 px-2 py-1 disabled:opacity-50" disabled={busy} aria-label={`Excluir regra ${rule.pattern}`} onClick={() => void perform(() => send('/api/category-rules/' + rule.id, 'DELETE', {}), 'Regra excluída.')}>Excluir</button>
    </li>)}</ul> : <p className="text-sm text-slate-400">Nenhuma regra ainda.</p>)}
  </section>;
}
