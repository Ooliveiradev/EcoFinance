import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="text-center space-y-6 animate-fade-in-up">
        {/* Glowing 404 */}
        <div className="relative inline-block">
          <p className="text-[120px] font-black leading-none bg-gradient-to-br from-emerald-400 to-teal-500 bg-clip-text text-transparent select-none">
            404
          </p>
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 blur-3xl -z-10 rounded-full" />
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-50">Página não encontrada</h1>
          <p className="text-slate-400 max-w-sm mx-auto text-sm">
            Essa página não existe ou foi movida. Verifique o endereço e tente novamente.
          </p>
        </div>

        {/* Back button */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-105"
        >
          ← Voltar ao Dashboard
        </Link>
      </div>
    </div>
  );
}
