import { describe, it, expect } from 'vitest';
import { importReviewSchema, importPreview,importSourceSchema,importTargetSchema,importIdSchema, type ImportRowView } from './imports';
const row = (patch: Partial<ImportRowView> = {}): ImportRowView => ({ id: '10000000-0000-4000-8000-000000000001', position: 1, state: 'valid', revision: 'v1', description: 'Mercado', amount: '-10.25', purchaseDate: '2026-10-01', competenceMonth: '2026-10-01', categoryId: '10000000-0000-4000-8000-000000000002', selected: true, resolution: 'new', duplicateId: null, warnings: [], provenance: {}, candidates: [], undoReason: null, ...patch });
describe('import review boundary', () => {
  it('requires complete exact money/date/category and an explicit existing id for a link', () => {
    expect(importSourceSchema.safeParse('document').success).toBe(true);expect(importSourceSchema.safeParse('notification').success).toBe(false);
    expect(importTargetSchema.safeParse({accountId:row().id,cardId:null}).success).toBe(true);expect(importTargetSchema.safeParse({accountId:null,cardId:row().id}).success).toBe(true);expect(importTargetSchema.safeParse({accountId:row().id,cardId:row().id}).success).toBe(false);expect(importTargetSchema.safeParse({accountId:null,cardId:null}).success).toBe(false);expect(importIdSchema.safeParse('../other').success).toBe(false);
    const input = { description: 'Mercado', amount: '-10.25', purchaseDate: '2026-10-01', competenceMonth: '2026-10-01', categoryId: row().categoryId, selected: true, resolution: 'new', duplicateId: null };
    expect(importReviewSchema.parse(input)).toEqual(input);
    for (const patch of [{ amount: '0' }, { amount: '1.999' }, { purchaseDate: '2026-02-30' }, { competenceMonth: '2026-10-03' }, { categoryId: null }, { resolution: 'link' }, { extra: true }, { description: ' ' }]) expect(importReviewSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    expect(importReviewSchema.safeParse({ ...input, resolution: 'link', duplicateId: row().id }).success).toBe(true);
  });
  it('computes selected new rows only, exactly, independently by competence', () => {
    expect(importPreview([row(), row({ amount: '0.10' }), row({ amount: '0.20' }), row({ resolution: 'link' }), row({ resolution: 'exclude' }), row({ selected: false }), row({ state: 'invalid' }), row({ amount: null }), row({ competenceMonth: null }), row({ competenceMonth: '2026-11-01' })])).toEqual([
      { month: '2026-10', income: '0.30', expenses: '10.25', balance: '-9.95' }, { month: '2026-11', income: '0.00', expenses: '10.25', balance: '-10.25' },
    ]);
    expect(importPreview([row(), row({ amount: '2.25' })], true)).toEqual([{ month: '2026-10', income: '0.00', expenses: '8.00', balance: '0.00' }]);
    expect(importPreview([])).toEqual([]);
  });
});
