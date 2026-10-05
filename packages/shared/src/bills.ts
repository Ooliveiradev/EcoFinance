import { daysBetween } from './month';

// =============================================================================
// Upcoming bills: due-date presentation
// =============================================================================
// The state is always derived from civil dates (no timestamps, no timezone
// arithmetic) and always carries a text label, so urgency is never conveyed by
// colour alone.
// =============================================================================

export type DueState = 'overdue' | 'today' | 'soon' | 'upcoming';

export interface DueDescription {
  state: DueState;
  /** Days until the due date; negative when overdue. */
  days: number;
  label: string;
}

export const SOON_THRESHOLD_DAYS = 3;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Describes how close `dueDate` is relative to `today`; null when either is not a valid civil date. */
export function describeDue(
  dueDate: string,
  today: string,
  soonThresholdDays: number = SOON_THRESHOLD_DAYS,
): DueDescription | null {
  const days = daysBetween(today, dueDate);
  if (days === null) return null;
  if (days < 0) return { state: 'overdue', days, label: `Atrasada há ${plural(-days, 'dia', 'dias')}` };
  if (days === 0) return { state: 'today', days, label: 'Vence hoje' };
  if (days === 1) return { state: 'soon', days, label: 'Vence amanhã' };
  return {
    state: days <= soonThresholdDays ? 'soon' : 'upcoming',
    days,
    label: `Vence em ${plural(days, 'dia', 'dias')}`,
  };
}
