'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate } from '@/lib/utils';
import { BACKUP_COLLECTIONS, BACKUP_COLLECTION_LABELS, DELETE_ACCOUNT_CONFIRMATION, DELETE_DATA_CONFIRMATION, RESTORE_CONFIRMATION, type DataSummary, type RestorePreview } from '@ecofinance/shared';

async function send(url: string, body: unknown, version: string, key = crypto.randomUUID(), method = 'POST') {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'If-Match': '"' + version + '"' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : failure.message ?? 'Não foi possível concluir. Tente novamente.');
  }
  return response.json();
}
const button = 'rounded bg-slate-700 px-4 py-2 disabled:opacity-50';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** One request at a time per panel; work only talks to the server, state changes stay in the handlers. */
function useRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  async function perform<T>(work: () => Promise<T>, success: (value: T) => string = () => ''): Promise<T | undefined> {
    setBusy(true); setError(''); setStatus('');
    try { const value = await work(); setStatus(success(value)); return value; } catch (failure) { setError(message(failure)); return undefined; } finally { setBusy(false); }
  }
  const feedback = <>{error && <p role="alert" className="text-red-400">{error}</p>}{status && <p role="status" className="text-emerald-400">{status}</p>}</>;
  return { busy, perform, feedback };
}

function ExportPanel({ summary }: { summary: DataSummary | null }) {
  const total = summary ? BACKUP_COLLECTIONS.reduce((sum, c) => sum + summary.counts[c], 0) : 0;
  return <div className="space-y-2">
    <h3 className="font-medium">Exportar</h3>
    <p className="text-sm text-slate-400">{summary ? `${summary.counts.transactions} lançamentos e ${total} registros no total.` : 'Carregando…'} Arquivos privados, baixados só pela sua sessão.</p>
    <div className="flex flex-wrap gap-2">
      <a className={button} href="/api/data/entries" download>Exportar lançamentos (CSV)</a>
      <a className={button} href="/api/data/backup" download>Baixar backup completo (JSON)</a>
    </div>
  </div>;
}

type Preview = RestorePreview & { key: string };
async function previewFile(file: File, limit: number) {
  if (file.size > limit) throw new Error('O arquivo excede o limite de restauração pelo app.');
  let backup: unknown;
  try { backup = JSON.parse(await file.text()); } catch { throw new Error('O arquivo não é um backup JSON válido.'); }
  const preview: RestorePreview = await send('/api/data/restore/preview', { backup }, '');
  return { backup, preview };
}
function PreviewTable({ preview }: { preview: Preview }) {
  return <div className="overflow-x-auto"><table className="text-sm"><caption className="text-left">Registros: backup e dados atuais</caption>
    <thead><tr><th scope="col" className="pr-4 text-left">Tipo</th><th scope="col" className="pr-4">Backup</th><th scope="col">Atual</th></tr></thead>
    <tbody>{BACKUP_COLLECTIONS.filter(c => preview.backup[c] || preview.current[c]).map(c => <tr key={c}><th scope="row" className="pr-4 text-left font-normal">{BACKUP_COLLECTION_LABELS[c]}</th><td className="pr-4 text-center">{preview.backup[c]}</td><td className="text-center">{preview.current[c]}</td></tr>)}</tbody>
  </table></div>;
}
function RestorePanel({ limit, reload }: { limit: number; reload: () => Promise<void> }) {
  const { busy, perform, feedback } = useRequest();
  const backup = useRef<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [replace, setReplace] = useState(false);
  const [adopt, setAdopt] = useState(false);
  async function choose(file: File | undefined) {
    setPreview(null); setReplace(false); setAdopt(false); backup.current = null;
    if (!file) return;
    const loaded = await perform(() => previewFile(file, limit));
    if (!loaded) return;
    backup.current = loaded.backup; setPreview({ ...loaded.preview, key: crypto.randomUUID() });
  }
  async function restore(current: Preview) {
    const done = await perform(() => send('/api/data/restore', { backup: backup.current, ownerMode: current.foreignOwner ? 'adopt' : 'same', confirm: RESTORE_CONFIRMATION }, current.currentRevision, current.key),
      result => `Backup restaurado: ${result.totals.entries} lançamentos, saldo ativo ${result.totals.amount}.`);
    if (!done) return;
    setPreview(null); backup.current = null; await reload();
  }
  return <div className="space-y-2">
    <h3 className="font-medium">Restaurar backup</h3>
    <p className="text-sm text-slate-400">A prévia valida o arquivo sem alterar nada. A restauração substitui todos os dados financeiros atuais em uma única operação: se falhar, nada muda.</p>
    {feedback}
    <label className="block text-sm">Arquivo de backup
      <input type="file" accept="application/json,.json" disabled={busy} onChange={e => choose(e.target.files?.[0])} className="mt-1 block w-full max-w-full text-sm" />
    </label>
    {preview && <div className="space-y-2" role="region" aria-label="Prévia da restauração">
      <p>Backup de {formatDate(preview.createdAt)}: {preview.totals.entries} lançamentos ({preview.totals.archived} arquivados), saldo ativo {preview.totals.amount}.</p>
      <PreviewTable preview={preview} />
      {preview.foreignOwner && <label className="flex gap-2 text-amber-300"><input type="checkbox" checked={adopt} onChange={e => setAdopt(e.target.checked)} />Este backup é de outra conta. Quero adotar estes dados nesta conta.</label>}
      <label className="flex gap-2"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Entendo que os dados atuais serão substituídos por este backup.</label>
      <button className={button} disabled={busy || !replace || (preview.foreignOwner && !adopt)} onClick={() => restore(preview)}>Restaurar backup</button>
    </div>}
  </div>;
}

function RetentionPanel({ summary, reload }: { summary: DataSummary | null; reload: () => Promise<void> }) {
  const { busy, perform, feedback } = useRequest();
  async function discard(id: string, version: string) {
    if (await perform(() => send('/api/data/originals/' + id, {}, version, undefined, 'DELETE'), () => 'Arquivo original apagado. Os lançamentos confirmados não mudaram.')) await reload();
  }
  const list = summary?.originals.length ? <ul className="space-y-1 text-sm">{summary.originals.map(o => <li key={o.id} className="flex flex-wrap items-center gap-2">
    <span>{o.filename} — apagado até {formatDate(o.expiresAt)}</span>
    <button className={button} disabled={busy} onClick={() => discard(o.id, o.revision)} aria-label={'Apagar original de ' + o.filename}>Apagar original</button>
  </li>)}</ul> : summary && <p className="text-sm">Nenhum arquivo original guardado.</p>;
  return <div className="space-y-2">
    <h3 className="font-medium">Retenção de arquivos importados</h3>
    <p className="text-sm text-slate-400">O arquivo original de uma importação fica guardado por até {summary?.retentionDays ?? 7} dias enquanto o lote não é confirmado ou cancelado, e é apagado na hora ao confirmar ou cancelar. Falhas de leitura não estendem esse prazo. Backups não incluem originais.</p>
    {feedback}{list}
  </div>;
}

function DeletePanel({ summary, reload }: { summary: DataSummary | null; reload: () => Promise<void> }) {
  const { busy, perform, feedback } = useRequest();
  const [scope, setScope] = useState<'data' | 'account'>('data');
  const [typed, setTyped] = useState('');
  const phrase = scope === 'data' ? DELETE_DATA_CONFIRMATION : DELETE_ACCOUNT_CONFIRMATION;
  function pick(next: 'data' | 'account') { setScope(next); setTyped(''); }
  async function remove(revision: string) {
    const done = await perform(() => send('/api/data/delete', { scope, confirm: typed }, revision), () => scope === 'data' ? 'Seus dados financeiros foram apagados. O login continua ativo.' : 'Conta excluída.');
    if (!done) return;
    if (scope === 'account') { window.location.assign('/login'); return; }
    setTyped(''); await reload();
  }
  return <div className="space-y-2">
    <h3 className="font-medium">Excluir dados</h3>
    <p className="text-sm text-slate-400">Irreversível. Baixe um backup antes. Outras contas não são afetadas.</p>
    {feedback}
    <fieldset className="space-y-1"><legend className="sr-only">O que excluir</legend>
      <label className="flex gap-2"><input type="radio" name="delete-scope" checked={scope === 'data'} onChange={() => pick('data')} />Apagar dados financeiros (mantém o login)</label>
      <label className="flex gap-2"><input type="radio" name="delete-scope" checked={scope === 'account'} onChange={() => pick('account')} />Excluir conta, login e dados</label>
    </fieldset>
    <label className="block text-sm">Digite {phrase} para confirmar
      <input value={typed} onChange={e => setTyped(e.target.value)} className="mt-1 block w-full max-w-sm rounded border border-slate-600 bg-transparent px-2 py-1" autoComplete="off" />
    </label>
    <button className="rounded bg-red-800 px-4 py-2 disabled:opacity-50" disabled={busy || !summary || typed !== phrase} onClick={() => summary && remove(summary.revision)}>Excluir definitivamente</button>
  </div>;
}

/** Export, backup, restore with preview, import-original retention and explicit deletion. */
export function DataControls() {
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    const response = await fetch('/api/data', { cache: 'no-store' });
    if (!response.ok) { setError(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : 'Não foi possível carregar o resumo dos seus dados.'); return; }
    setError(''); setSummary(await response.json());
  }, []);
  useEffect(() => { reload().catch(failure => setError(message(failure))); }, [reload]);
  return <section aria-labelledby="data-title" className="space-y-6 rounded-xl border border-slate-700 p-4">
    <h2 id="data-title" className="text-lg font-semibold">Seus dados</h2>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <ExportPanel summary={summary} />
    <RestorePanel limit={summary?.limits.backupBytes ?? Infinity} reload={reload} />
    <RetentionPanel summary={summary} reload={reload} />
    <DeletePanel summary={summary} reload={reload} />
  </section>;
}
