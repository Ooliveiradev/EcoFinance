'use client';
import { useState } from 'react';

export function SessionControls() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function logout(all: boolean) {
    setBusy(true); setError('');
    try {
      if (all) {
        const response = await fetch('/api/auth/revoke-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (!response.ok && response.status !== 401) throw new Error();
      }
      const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok && response.status !== 401) throw new Error();
      window.location.assign('/login');
    } catch { setError('Não foi possível encerrar a sessão no servidor. Tente novamente.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-slate-700 p-4">
    <h2 className="text-lg font-semibold">Sessões de acesso</h2>
    <button disabled={busy} onClick={() => logout(false)} className="rounded bg-slate-700 px-4 py-2">Sair deste dispositivo</button>{' '}
    <button disabled={busy} onClick={() => logout(true)} className="rounded bg-slate-700 px-4 py-2">Sair de todos os dispositivos</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}
