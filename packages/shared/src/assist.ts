import { z } from 'zod';

/**
 * Category assistance (#11). Suggestions come first from the user's own rules —
 * created in settings or learned from review corrections — and only then from an
 * optional local model. A suggestion never sets a category: the row still needs
 * the user's review, and only existing categories can be suggested.
 */
export const CATEGORY_RULE_LIMITS = { rules: 200, pattern: 80, minimum: 3, reason: 160 } as const;
export const categoryRuleInputSchema = z.object({
  pattern: z.string().trim().min(CATEGORY_RULE_LIMITS.minimum).max(CATEGORY_RULE_LIMITS.pattern),
  categoryId: z.string().uuid(),
}).strict();
export interface CategoryRule {
  id: string;
  /** Normalized text (see ruleKey). `equals` rules are learned; `contains` rules are written by the user. */
  pattern: string; match: 'equals' | 'contains'; source: 'learned' | 'user';
  categoryId: string; updatedAt: string;
}
export interface CategorySuggestion { categoryId: string; source: 'rule' | 'model'; reason: string; ruleId?: string; model?: string }

/**
 * Stable key of a description: lower case, no accents, digits, dates or
 * punctuation, so "PIX 12/09 PADARIA EXEMPLO*123" and "Padaria Exemplo" meet.
 */
export function ruleKey(description: string) {
  return description.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CATEGORY_RULE_LIMITS.pattern);
}
/** User rules win over learned ones; among `contains` rules the longest pattern wins. */
export function matchRule(rules: readonly CategoryRule[], description: string): CategoryRule | null {
  const key = ruleKey(description); if (key.length < CATEGORY_RULE_LIMITS.minimum) return null;
  const padded = ` ${key} `;
  const candidates = rules.filter(rule => rule.match === 'equals' ? rule.pattern === key : padded.includes(` ${rule.pattern} `));
  return candidates.sort((a, b) => Number(b.source === 'user') - Number(a.source === 'user') || Number(b.match === 'equals') - Number(a.match === 'equals') || b.pattern.length - a.pattern.length)[0] ?? null;
}
