import { isCivilDate } from './finance';

// =============================================================================
// Month selection helpers
// =============================================================================
// A month is addressed as "YYYY-MM" (the `mes` query parameter on the web and
// the selected month on mobile). Everything here is pure and uses civil dates;
// the only place a timezone matters is deciding what "today" means.
// =============================================================================

export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
export const MIN_MONTH_YEAR = 2000;
export const MAX_MONTH_YEAR = 2100;

export const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export interface MonthParts {
  year: number;
  /** 1-12 */
  month: number;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Parses "YYYY-MM"; returns null for anything else, including out-of-range years. */
export function parseMonthParam(value: string | null | undefined): MonthParts | null {
  if (typeof value !== 'string') return null;
  const match = MONTH_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < MIN_MONTH_YEAR || year > MAX_MONTH_YEAR) return null;
  return { year, month };
}

export function formatMonthParam({ year, month }: MonthParts): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function isMonthParam(value: string | null | undefined): value is string {
  return parseMonthParam(value) !== null;
}

/** Moves a month by `delta` months; null when the result leaves the supported range. */
export function shiftMonth(value: string, delta: number): string | null {
  const parts = parseMonthParam(value);
  if (!parts || !Number.isInteger(delta)) return null;
  const shifted = formatMonthParam(shiftMonthUnbounded(parts, delta));
  return isMonthParam(shifted) ? shifted : null;
}

/** "outubro de 2026"; null input yields an empty string so callers never print "undefined". */
export function monthLabel(value: string): string {
  const parts = parseMonthParam(value);
  if (!parts) return '';
  return `${MONTH_NAMES_PT[parts.month - 1]} de ${parts.year}`;
}

/** Civil date (YYYY-MM-DD) for `now` in the given IANA timezone. */
export function civilToday(now: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function currentMonthParam(now: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return civilToday(now, timeZone).slice(0, 7);
}

export interface ResolvedMonth {
  /** Always a valid "YYYY-MM". */
  month: string;
  /** False when a value was supplied but unusable, so the UI can say so instead of silently changing the month. */
  valid: boolean;
  isCurrent: boolean;
  current: string;
}

/** Resolves the requested month, falling back to the current month in the user's timezone. */
export function resolveMonthParam(
  raw: string | null | undefined,
  now: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): ResolvedMonth {
  const current = currentMonthParam(now, timeZone);
  const supplied = raw !== null && raw !== undefined && raw !== '';
  if (supplied && isMonthParam(raw)) return { month: raw, valid: true, isCurrent: raw === current, current };
  return { month: current, valid: !supplied, isCurrent: true, current };
}

export interface MonthBounds {
  /** First civil day of the month (inclusive). */
  start: string;
  /** First civil day of the next month (exclusive). */
  endExclusive: string;
}

export function monthBounds(value: string): MonthBounds | null {
  const parts = parseMonthParam(value);
  if (!parts) return null;
  const next = shiftMonthUnbounded(parts, 1);
  return { start: `${formatMonthParam(parts)}-01`, endExclusive: `${formatMonthParam(next)}-01` };
}

function shiftMonthUnbounded(parts: MonthParts, delta: number): MonthParts {
  const index = parts.year * 12 + (parts.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Both must be civil dates. */
export function daysBetween(from: string, to: string): number | null {
  if (!isCivilDate(from) || !isCivilDate(to)) return null;
  const toUtc = (value: string) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}
