'use client';
import { useState, useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export default function LoginPage() {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: String(fields.get('email')).trim().toLowerCase(), password: String(fields.get('password')) }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : response.status >= 500 ? 'Servidor indisponível. Tente novamente.' : 'Email ou senha inválidos.');
        return;
      }
      form.reset();
      // A new identity must discard any anonymous/previous-user RSC cache.
      window.location.replace('/');
    } catch { setError('Falha na conexão. Seus dados permanecem no formulário.'); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto max-w-md px-6 py-16">
    <h1 className="text-2xl font-bold mb-4">Entrar no EcoFinance</h1>
    <form onSubmit={login} className="space-y-4">
      <label htmlFor="email" className="block">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} disabled={!ready || busy} className="w-full rounded-lg bg-slate-800 p-3" />
      <label htmlFor="password" className="block">Senha</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={!ready || busy} className="w-full rounded-lg bg-slate-800 p-3" />
      <button type="submit" disabled={!ready || busy} className="rounded-lg bg-emerald-700 px-5 py-3">{busy ? 'Entrando…' : 'Entrar'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    <p className="mt-6 text-slate-300">Primeiro acesso ou senha esquecida: peça ao operador da instalação para provisionar ou recuperar seu acesso. Nenhum serviço de email pago é necessário.</p>
  </section>;
}
