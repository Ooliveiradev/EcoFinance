'use client';
import { useCallback, useEffect, useState } from 'react';
import type { CategoryRule } from '@ecofinance/shared';

/**
 * Category rules (#11): learned from import reviews or written here. They only
 * pre-select a category during review; nothing is categorized without saving a row.
 */
interface Category { id: string; name: string; archivedAt?: string | null }
interface Assistant { model: string; label: string; external: boolean; consent: { acceptedAt: string } | null }
interface RulesState { rules: CategoryRule[]; assistant: Assistant | null }
/** External assistant (#11): off until the user reads what is sent and turns it on. */
function ExternalAssist({ assistant, busy, toggle }: { assistant: Assistant; busy: boolean; toggle: (enabled: boolean) => void }) {
  const on = Boolean(assistant.consent);
  return <div className="space-y-2 rounded border border-slate-700 p-3 text-sm">
    <p className="font-semibold">Assistente externo: {assistant.label} ({assistant.model}) — {on ? 'ligado por você' : 'desligado'}</p>
    <p className="text-slate-400">Ao ligar, cada análise de importação envia ao serviço {assistant.label}, fora desta instalação, apenas das linhas sem regra:</p>
    <ul className="list-disc pl-5 text-slate-400">
      <li>a descrição do lançamento (até 200 caracteres) e o valor;</li>
      <li>os nomes das suas categorias ativas.</li>
    </ul>
    <p className="text-slate-400">Não são enviados: contas, cartões, datas, ids, saldos nem o arquivo. A sugestão só pré-seleciona a categoria; nada é salvo sem a sua revisão. O plano gratuito do provedor tem limite de uso; quando ele acaba, a revisão continua manual, sem outro provedor pago.</p>
    <button type="button" className={button} disabled={busy} onClick={() => toggle(!on)}>{on ? 'Desligar assistente externo' : `Enviar descrições ao ${assistant.label}`}</button>
  </div>;
}
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
  const [editing, setEditing] = useState<string | null>(null);
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
    if (await perform(() => send(editing ? '/api/category-rules/' + editing : '/api/category-rules', editing ? 'PATCH' : 'POST', { pattern, categoryId }), 'Regra salva.')) {
      setPattern(''); setCategoryId(''); setEditing(null);
    }
  }
  const names = new Map(categories.map(c => [c.id, c.name]));
  return <section aria-labelledby="rules-title" className="space-y-4 rounded-xl border border-slate-700 p-4">
    <h2 id="rules-title" className="text-lg font-semibold">Regras de categoria</h2>
    <p className="text-sm text-slate-400">Na revisão de importações, a categoria é pré-selecionada pelas suas regras e só vale ao salvar a linha. As regras aprendidas vêm das categorias que você escolhe na revisão.</p>
    <p className="text-sm text-slate-400">{!state ? 'Carregando regras de categoria…' : !state.assistant ? 'Assistente por modelo desligado nesta instalação: só suas regras sugerem categorias.' : state.assistant.external ? (state.assistant.consent ? `Linhas sem regra recebem sugestão do ${state.assistant.label}, um serviço externo que você ligou.` : 'Só suas regras sugerem categorias. Nenhum dado é enviado a serviço externo enquanto o assistente externo estiver desligado.') : `Linhas sem regra recebem sugestão do modelo local ${state.assistant.model}, executado no servidor desta instalação. Nenhum dado é enviado a serviço externo.`}</p>
    {state?.assistant?.external && <ExternalAssist assistant={state.assistant} busy={busy} toggle={enabled => void perform(() => send('/api/category-rules/assist', 'PUT', { enabled }), enabled ? 'Assistente externo ligado.' : 'Assistente externo desligado.')} />}
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {status && <p role="status" className="text-emerald-400">{status}</p>}
    <form className="flex flex-wrap items-end gap-2" action={addRule}>
      {editing && <p className="w-full text-sm" role="status">Editando regra. Ao salvar, ela passa a ser uma regra criada por você.</p>}
      <label className="text-sm">Descrição contém<input aria-label="Descrição contém" value={pattern} onChange={e => setPattern(e.target.value)} required minLength={3} maxLength={80} disabled={busy || !state} className="mt-1 block rounded border border-slate-600 bg-transparent px-2 py-1" /></label>
      <label className="text-sm">Categoria<select aria-label="Categoria da regra" value={categoryId} onChange={e => setCategoryId(e.target.value)} required disabled={busy || !state} className="mt-1 block rounded border border-slate-600 bg-transparent px-2 py-1"><option value="">Escolha</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button type="submit" className={button} disabled={busy || !state || pattern.trim().length < 3 || !categoryId}>{editing ? 'Salvar regra' : 'Adicionar regra'}</button>
      {editing && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(null); setPattern(''); setCategoryId(''); }}>Cancelar edição</button>}
    </form>
    {state && (state.rules.length ? <ul aria-label="Regras de categoria" className="space-y-1 text-sm">{state.rules.map(rule => <li key={rule.id} className="flex flex-wrap items-center gap-2">
      <span className="break-all">{rule.match === 'contains' ? 'Contém' : 'Igual a'} “{rule.pattern}” → {names.get(rule.categoryId) ?? 'categoria arquivada (sem efeito)'} · {rule.source === 'user' ? 'criada por você' : 'aprendida'}</span>
      <button className="rounded border border-slate-600 px-2 py-1 disabled:opacity-50" disabled={busy} aria-label={`Editar regra ${rule.pattern}`} onClick={() => { setEditing(rule.id); setPattern(rule.pattern); setCategoryId(names.has(rule.categoryId) ? rule.categoryId : ''); setStatus(''); setError(''); }}>Editar</button>
      <button className="rounded border border-slate-600 px-2 py-1 disabled:opacity-50" disabled={busy || editing === rule.id} aria-label={`Excluir regra ${rule.pattern}`} onClick={() => void perform(() => send('/api/category-rules/' + rule.id, 'DELETE', {}), 'Regra excluída.')}>Excluir</button>
    </li>)}</ul> : <p className="text-sm text-slate-400">Nenhuma regra ainda.</p>)}
  </section>;
}
