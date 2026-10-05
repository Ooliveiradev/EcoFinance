'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section role="alert" className="space-y-4 p-6">
    <h1 className="text-xl font-semibold">Não foi possível carregar seus dados</h1>
    <p>Verifique sua conexão e tente novamente. A falha não representa saldo zero.</p>
    <button onClick={reset} className="rounded bg-emerald-700 px-4 py-2">Tentar novamente</button>
  </section>;
}
