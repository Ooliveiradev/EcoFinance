import { describe, expect, it } from 'vitest';
import { categoryRuleInputSchema, matchRule, ruleKey, type CategoryRule } from './assist';

const rule = (patch: Partial<CategoryRule>): CategoryRule => ({ id: 'r', pattern: 'padaria exemplo', match: 'equals', source: 'learned', categoryId: '10000000-0000-4000-8000-000000000001', updatedAt: '2026-10-01T00:00:00.000Z', ...patch });
describe('category rules', () => {
  it('normalizes descriptions without accents, digits, dates or punctuation', () => {
    expect(ruleKey('PIX 12/09 PADARIA ÉXEMPLO*123 ')).toBe('pix padaria exemplo');
    expect(ruleKey('Padaria Exemplo')).toBe('padaria exemplo');
    expect(ruleKey('x'.repeat(100))).toHaveLength(80);
  });
  it('prefers user rules, then exact learned matches, then the longest contained pattern', () => {
    const learned = rule({ id: 'learned', pattern: 'pix padaria exemplo' }), short = rule({ id: 'short', match: 'contains', source: 'user', pattern: 'padaria' });
    const long = rule({ id: 'long', match: 'contains', source: 'user', pattern: 'padaria exemplo' });
    expect(matchRule([learned], 'PIX 01/10 Padaria Exemplo')?.id).toBe('learned');
    expect(matchRule([learned, short], 'PIX 01/10 Padaria Exemplo')?.id).toBe('short');
    expect(matchRule([learned, short, long], 'PIX 01/10 Padaria Exemplo')?.id).toBe('long');
    // Whole words only: "padaria" does not match "padariasul".
    expect(matchRule([short], 'PADARIASUL')).toBeNull();
    expect(matchRule([learned], 'Padaria')).toBeNull(); expect(matchRule([short], '12/09')).toBeNull();
  });
  it('validates rules written by the user', () => {
    expect(categoryRuleInputSchema.parse({ pattern: ' Mercado ', categoryId: rule({}).categoryId })).toEqual({ pattern: 'Mercado', categoryId: rule({}).categoryId });
    for (const invalid of [{ pattern: 'ab', categoryId: rule({}).categoryId }, { pattern: 'mercado', categoryId: 'x' }, { pattern: 'mercado', categoryId: rule({}).categoryId, extra: 1 }])
      expect(categoryRuleInputSchema.safeParse(invalid).success).toBe(false);
  });
});
