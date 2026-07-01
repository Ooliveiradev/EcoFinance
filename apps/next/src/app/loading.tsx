export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-40 bg-slate-800 rounded-xl" />
        <div className="h-4 w-64 bg-slate-800/60 rounded-lg" />
      </div>

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-slate-700/30 bg-slate-900/60 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 bg-slate-800 rounded" />
              <div className="h-9 w-9 bg-slate-800 rounded-xl" />
            </div>
            <div className="h-8 w-32 bg-slate-800 rounded-lg" />
            <div className="h-4 w-20 bg-slate-800/60 rounded" />
          </div>
        ))}
      </div>

      {/* Charts + table skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-700/30 bg-slate-900/60 p-6 space-y-4">
          <div className="h-5 w-48 bg-slate-800 rounded" />
          <div className="h-[240px] bg-slate-800/40 rounded-xl" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-4 bg-slate-800/60 rounded" />
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 rounded-2xl border border-slate-700/30 bg-slate-900/60 p-6 space-y-4">
          <div className="h-5 w-40 bg-slate-800 rounded" />
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 bg-slate-800/40 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
