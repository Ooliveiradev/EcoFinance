import { describe, it, expect } from 'vitest';
import { EntryQuerySchema } from './access';
describe('owned financial query contracts', () => {
  it('defaults to a bounded limit and rejects caller-supplied owner/model fields', () => {
    expect(EntryQuerySchema.parse({})).toEqual({limit:20});
    for (const input of [{ownerId:'someone'},{userId:'someone'},{minAmount:1},{limit:0},{limit:101},{limit:1.5},{id:'invalid'},{accountId:'invalid'},{description:'x'.repeat(121)}]) expect(EntryQuerySchema.safeParse(input).success).toBe(false);
  });
  it('accepts UUID/date ranges and rejects ambiguous, impossible or inverted dates', () => {
    const input={accountId:'10000000-0000-4000-8000-000000000001',id:'10000000-0000-4000-8000-000000000002',startDate:'2024-02-29',endDate:'2024-03-01',description:'Mercado',limit:'100'};
    expect(EntryQuerySchema.parse(input).limit).toBe(100);
    for(const value of [{startDate:'02/03/2026'},{startDate:'2026-02-29'},{startDate:'2026-10-01',endDate:'2026-09-30'}]) expect(EntryQuerySchema.safeParse(value).success).toBe(false);
    expect(EntryQuerySchema.safeParse({startDate:'2026-01-01'}).success).toBe(true);
    expect(EntryQuerySchema.safeParse({endDate:'2026-01-01'}).success).toBe(true);
  });
});
