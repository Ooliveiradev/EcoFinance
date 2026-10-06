'use client';

import React, { lazy, Suspense } from 'react';
import { formatBRL } from '@ecofinance/shared';

interface CategoryItem {
  id?: string;
  formatted?: string;
  name: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { color: string; formatted?: string } }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  if (!data) return null;
  return (
    <div className="bg-surface text-foreground border border-border rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-muted mb-0.5">{data.name}</p>
      <p className="font-bold text-foreground">{data.payload.formatted ?? formatBRL(data.value)}</p>
    </div>
  );
}

const Chart = lazy(async () => {
  const { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } = await import('recharts');

  function LoadedChart({
    data: categoryData,
    colors: CATEGORY_COLORS,
  }: {
    data: CategoryItem[];
    colors: Record<string, string>;
  }) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart aria-label="Gráfico de distribuição de despesas por categoria">
          <Pie
            data={categoryData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={88}
            paddingAngle={2}
            dataKey="value"
            stroke="var(--surface)"
            strokeWidth={2}
          >
            {categoryData.map((entry) => (
              <Cell
                key={entry.id ?? entry.name}
                fill={entry.color || CATEGORY_COLORS[entry.name] || 'var(--color-muted)'}
                className="transition-opacity hover:opacity-85"
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return { default: LoadedChart };
});

export default function CategoryChart(props: {
  data: CategoryItem[];
  colors: Record<string, string>;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-[240px] flex items-center justify-center text-xs text-muted">
          Carregando gráfico…
        </div>
      }
    >
      <Chart {...props} />
    </Suspense>
  );
}
