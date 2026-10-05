import { describe, expect, it } from 'vitest';
import {
  civilToday,
  currentMonthParam,
  daysBetween,
  formatMonthParam,
  isMonthParam,
  monthBounds,
  monthLabel,
  parseMonthParam,
  resolveMonthParam,
  shiftMonth,
} from './month';

describe('parseMonthParam', () => {
  it('accepts a well-formed month', () => {
    expect(parseMonthParam('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthParam('2000-01')).toEqual({ year: 2000, month: 1 });
    expect(parseMonthParam('2100-12')).toEqual({ year: 2100, month: 12 });
  });

  it.each([
    ['empty', ''],
    ['month zero', '2026-00'],
    ['month thirteen', '2026-13'],
    ['single digit month', '2026-1'],
    ['full date', '2026-10-01'],
    ['surrounding space', ' 2026-10'],
    ['year below range', '1999-12'],
    ['year above range', '2101-01'],
    ['letters', 'abcd-ef'],
  ])('rejects %s', (_name, value) => {
    expect(parseMonthParam(value)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parseMonthParam(null)).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
    expect(parseMonthParam(202610 as unknown as string)).toBeNull();
  });
});

describe('formatMonthParam / isMonthParam', () => {
  it('pads year and month', () => {
    expect(formatMonthParam({ year: 2026, month: 3 })).toBe('2026-03');
    expect(formatMonthParam({ year: 987, month: 11 })).toBe('0987-11');
  });

  it('narrows valid values only', () => {
    expect(isMonthParam('2026-10')).toBe(true);
    expect(isMonthParam('2026-1')).toBe(false);
    expect(isMonthParam(null)).toBe(false);
  });
});

describe('shiftMonth', () => {
  it('moves within a year and across year boundaries', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-06', 0)).toBe('2026-06');
    expect(shiftMonth('2026-06', 25)).toBe('2028-07');
    expect(shiftMonth('2026-06', -18)).toBe('2024-12');
  });

  it('returns null outside the supported range or for invalid input', () => {
    expect(shiftMonth('2000-01', -1)).toBeNull();
    expect(shiftMonth('2100-12', 1)).toBeNull();
    expect(shiftMonth('nope', 1)).toBeNull();
    expect(shiftMonth('2026-10', 1.5)).toBeNull();
  });
});

describe('monthLabel', () => {
  it('uses Portuguese month names', () => {
    expect(monthLabel('2026-01')).toBe('janeiro de 2026');
    expect(monthLabel('2026-03')).toBe('março de 2026');
    expect(monthLabel('2026-12')).toBe('dezembro de 2026');
  });

  it('is empty for an invalid month', () => {
    expect(monthLabel('2026-13')).toBe('');
  });
});

describe('civilToday / currentMonthParam', () => {
  it('uses the timezone, not UTC, to decide the civil day', () => {
    // 02:30 UTC on 1 Nov is still 31 Oct 23:30 in São Paulo (UTC-3).
    const instant = new Date('2026-11-01T02:30:00Z');
    expect(civilToday(instant)).toBe('2026-10-31');
    expect(currentMonthParam(instant)).toBe('2026-10');
    expect(civilToday(instant, 'UTC')).toBe('2026-11-01');
    expect(currentMonthParam(instant, 'UTC')).toBe('2026-11');
  });

  it('keeps a leap day in the right month', () => {
    expect(civilToday(new Date('2028-02-29T12:00:00Z'))).toBe('2028-02-29');
  });
});

describe('resolveMonthParam', () => {
  const now = new Date('2026-10-05T13:00:00Z');

  it('uses a valid requested month', () => {
    expect(resolveMonthParam('2026-09', now)).toEqual({ month: '2026-09', valid: true, isCurrent: false, current: '2026-10' });
    expect(resolveMonthParam('2026-10', now)).toMatchObject({ month: '2026-10', valid: true, isCurrent: true });
  });

  it('falls back to the current month when nothing is requested', () => {
    expect(resolveMonthParam(undefined, now)).toMatchObject({ month: '2026-10', valid: true, isCurrent: true });
    expect(resolveMonthParam(null, now)).toMatchObject({ month: '2026-10', valid: true });
    expect(resolveMonthParam('', now)).toMatchObject({ month: '2026-10', valid: true });
  });

  it('flags an unusable requested month instead of hiding it', () => {
    expect(resolveMonthParam('2026-99', now)).toEqual({ month: '2026-10', valid: false, isCurrent: true, current: '2026-10' });
    expect(resolveMonthParam('<script>', now)).toMatchObject({ valid: false });
  });
});

describe('monthBounds', () => {
  it('returns inclusive start and exclusive end', () => {
    expect(monthBounds('2026-10')).toEqual({ start: '2026-10-01', endExclusive: '2026-11-01' });
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', endExclusive: '2027-01-01' });
    expect(monthBounds('2100-12')).toEqual({ start: '2100-12-01', endExclusive: '2101-01-01' });
  });

  it('is null for an invalid month', () => {
    expect(monthBounds('2026-00')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole civil days', () => {
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysBetween('2026-10-05', '2026-10-06')).toBe(1);
    expect(daysBetween('2026-10-05', '2026-10-01')).toBe(-4);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('does not drift across daylight-saving changes', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
  });

  it('is null when a date is not a valid civil date', () => {
    expect(daysBetween('2026-02-30', '2026-03-01')).toBeNull();
    expect(daysBetween('2026-03-01', 'x')).toBeNull();
  });
});
