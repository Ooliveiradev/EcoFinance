'use client';
import { lazy, Suspense } from 'react';

import { formatBRL } from '@/lib/utils';
function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { color: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  if (!data) return null;
  return (
    <div className="bg-slate-800/90 backdrop-blur-lg border border-slate-700/50 rounded-xl px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{data.name}</p>
      <p className="text-sm font-semibold text-slate-50">{formatBRL(data.value)}</p>
    </div>
  );
}


const Chart = lazy(async () => {
const {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} = await import('recharts');
function LoadedChart({ data: categoryData, colors: CATEGORY_COLORS }: { data: { name: string; value: number; color: string }[]; colors: Record<string,string> }) { return (<ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {categoryData.map((entry) => (
                          <Cell key={entry.name} fill={CATEGORY_COLORS[entry.name] || CATEGORY_COLORS['desconhecido']} className="transition-opacity hover:opacity-80" />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>); }

return { default: LoadedChart };
});
export default function CategoryChart(props: { data: {name:string;value:number;color:string}[];colors:Record<string,string> }) { return <Suspense fallback={<div>Carregando gráfico…</div>}><Chart {...props}/></Suspense>; }
