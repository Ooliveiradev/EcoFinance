'use client';

import React, { lazy, Suspense } from 'react';

export interface ChartSeries { key: string; name: string; color: string }
/** `values` only sizes the bars; `labels` carries the exact formatted money shown in tooltips. */
export interface ChartPoint { label: string; values: Record<string, number>; labels: Record<string, string> }

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; name: string; color: string; payload: { labels: Record<string, string> } }>;
}
function ExactTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface text-foreground border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-muted mb-1">{label}</p>
      {payload.map(item => (
        <p key={item.dataKey} className="font-bold" style={{ color: item.color }}>
          {item.name}: {item.payload.labels[String(item.dataKey).replace(/^values\./, '')]}
        </p>
      ))}
    </div>
  );
}

const Chart = lazy(async () => {
  const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } = await import('recharts');
  function LoadedChart({ data, series, label, stacked }: { data: ChartPoint[]; series: ChartSeries[]; label: string; stacked?: boolean }) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} aria-label={label} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} width={64} />
          <Tooltip content={<ExactTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map(item => (
            <Bar key={item.key} dataKey={`values.${item.key}`} name={item.name} fill={item.color} radius={[4, 4, 0, 0]} stackId={stacked ? 'stack' : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return { default: LoadedChart };
});

export default function ReportsChart(props: { data: ChartPoint[]; series: ChartSeries[]; label: string; stacked?: boolean }) {
  return (
    <Suspense fallback={<div role="status" className="h-full flex items-center justify-center text-xs text-muted">Carregando gráfico…</div>}>
      <Chart {...props} />
    </Suspense>
  );
}
