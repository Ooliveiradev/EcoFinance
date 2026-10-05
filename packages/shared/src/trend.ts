// =============================================================================
// Month-over-month trend presentation
// =============================================================================
// A trend is only reported when there is a previous value to compare against;
// "no baseline" is a distinct, explicitly worded state instead of an invented
// percentage.
// =============================================================================

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface TrendDescription {
  direction: TrendDirection;
  /** Percentage change, or null when there is no usable baseline. */
  percent: number | null;
  /** Complete accessible sentence, e.g. "Aumento de 12,5% em relação ao mês anterior". */
  label: string;
  /** Compact visible text, e.g. "+12,5%". */
  short: string;
}

/** Percentage change from `previous` to `current`; null when `previous` is zero or any value is not finite. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatPercent(value: number): string {
  return Math.abs(value).toFixed(1).replace('.', ',');
}

export function describeTrend(percent: number | null): TrendDescription {
  if (percent === null || !Number.isFinite(percent)) {
    return { direction: 'unknown', percent: null, label: 'Sem mês anterior para comparar', short: '—' };
  }
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) {
    return { direction: 'flat', percent: 0, label: 'Sem variação em relação ao mês anterior', short: '0,0%' };
  }
  if (rounded > 0) {
    return {
      direction: 'up',
      percent: rounded,
      label: `Aumento de ${formatPercent(rounded)}% em relação ao mês anterior`,
      short: `+${formatPercent(rounded)}%`,
    };
  }
  return {
    direction: 'down',
    percent: rounded,
    label: `Queda de ${formatPercent(rounded)}% em relação ao mês anterior`,
    short: `−${formatPercent(rounded)}%`,
  };
}
