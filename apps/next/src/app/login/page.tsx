'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [credential, setCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
      if (!response.ok) { setError('Não foi possível entrar. Verifique a credencial.'); return; }
      setCredential('');
      router.replace('/');
      router.refresh();
    } catch { setError('Falha na conexão com o servidor.'); }
    finally { setBusy(false); }
  }
  return (
    <section className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold mb-4">Entrar no EcoFinance</h1>
      <p className="text-slate-300 mb-6">Informe sua credencial de acesso para consultar os dados financeiros.</p>
      <form onSubmit={login} className="space-y-4">
        <label htmlFor="access-credential" className="block">Credencial de acesso</label>
        <input id="access-credential" type="password" autoComplete="current-password" required value={credential} onChange={event => setCredential(event.target.value)} className="w-full rounded-lg bg-slate-800 p-3" />
        <button type="submit" disabled={busy} className="rounded-lg bg-emerald-700 px-5 py-3">{busy ? 'Entrando…' : 'Entrar'}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
