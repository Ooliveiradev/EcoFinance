import { describe, expect, it } from 'vitest';
import { formatCivilDate } from './utils';

describe('formatCivilDate', () => {
  it('keeps the civil day regardless of the process time zone', () => {
    expect(formatCivilDate('2026-10-18')).toBe('18 de out. de 2026');
    expect(formatCivilDate('2026-01-01')).toBe('01 de jan. de 2026');
  });
});
