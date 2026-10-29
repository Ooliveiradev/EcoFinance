'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CaptureSource } from '@ecofinance/shared';

/**
 * Optional expense capture (#19). Notices are read only by the Android app; the web
 * shows which apps are enabled, lets the user remove them and reviews suggestions
 * in Imports. Browsers cannot read the phone's notifications.
 */
const button = 'rounded border border-slate-600 px-2 py-1 disabled:opacity-50';
export function CaptureSources() {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const reload = useCallback(async () => {
    const response = await fetch('/api/captures/sources', { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível carregar a captura de gastos.');
    setSources((await response.json()).sources);
  }, []);
  useEffect(() => { reload().catch(failure => setError(failure instanceof Error ? failure.message : String(failure))); }, [reload]);
  async function save(next: CaptureSource[], done: string) {
    setBusy(true); setError(''); setStatus('');
    try {
      const response = await fetch('/api/captures/sources', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sources: next }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? 'Não foi possível salvar. Tente novamente.');
      await reload(); setStatus(done);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); } finally { setBusy(false); }
  }
  return <section aria-labelledby="capture-title" className="space-y-3 rounded-xl border border-slate-700 p-4">
    <h2 id="capture-title" className="text-lg font-semibold">Captura de gastos</h2>
    <p className="text-sm text-slate-400">Opcional e só no app Android: avisos dos apps bancários escolhidos viram sugestões em <Link className="underline" href="/imports">Importações</Link>, e nada entra nos totais sem a sua confirmação. O navegador não lê as notificações do celular, e o iPhone não permite esse acesso.</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {status && <p role="status" className="text-emerald-400">{status}</p>}
    {sources === null ? <p className="text-sm text-slate-400">Carregando…</p> : sources.length ? <ul aria-label="Apps com captura" className="space-y-1 text-sm">{sources.map(source => <li key={source.package} className="flex flex-wrap items-center gap-2">
      <span className="break-all">{source.label} ({source.package}) → {source.cardId ? 'cartão' : 'conta'}</span>
      <button className={button} disabled={busy} aria-label={`Remover ${source.label}`} onClick={() => void save(sources.filter(item => item.package !== source.package), `${source.label} removido.`)}>Remover</button>
    </li>)}</ul> : <p className="text-sm text-slate-400">Nenhum app habilitado: a captura está desligada.</p>}
    {!!sources?.length && <button className={button} disabled={busy} onClick={() => void save([], 'Captura pausada para todos os aparelhos.')}>Pausar captura</button>}
  </section>;
}
