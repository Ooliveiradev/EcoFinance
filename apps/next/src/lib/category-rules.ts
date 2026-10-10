import { randomUUID } from 'node:crypto';
import type { Database } from '@ecofinance/db';
import { CATEGORY_RULE_LIMITS, categoryRuleInputSchema, matchRule, ruleKey, type CategoryRule, type CategorySuggestion } from '@ecofinance/shared';
import { operation, fail } from './finance-operation';
import { stableId } from './planning-lock';
import { cardReference } from './card-store';
import { assistConfig, suggestCategories, type AssistConfig } from './assist-ollama';

/**
 * Category rules (#11) live in the owner's preferences document, next to the saved
 * import layouts, so backup and restore already carry them. Learned rules come from
 * review corrections; user rules are written in settings and are never overwritten.
 */
async function preferencesOf(tx: Database, owner: string) {
  return (await tx.owned('preferences', owner, { limit: 1 }))[0] ?? null;
}
export async function categoryRules(db: Database, owner: string): Promise<CategoryRule[]> {
  return ((await preferencesOf(db, owner))?.settings.categoryRules ?? []) as CategoryRule[];
}
async function writeRules(tx: Database, owner: string, update: (rules: CategoryRule[]) => CategoryRule[]) {
  const now = new Date(), current = await preferencesOf(tx, owner);
  const rules = update(((current?.settings.categoryRules ?? []) as CategoryRule[]).slice());
  // Over the limit, the oldest learned rules go first; user rules are kept.
  const ordered = rules.sort((a, b) => Number(b.source === 'user') - Number(a.source === 'user') || b.updatedAt.localeCompare(a.updatedAt)).slice(0, CATEGORY_RULE_LIMITS.rules);
  await tx.put('preferences', { id: current?.id ?? stableId(['preferences', owner]), ownerId: owner, settings: { ...current?.settings, categoryRules: ordered }, createdAt: current?.createdAt ?? now, updatedAt: now });
  return ordered;
}
/** Remember the category the user chose for a reviewed description (inside the review transaction). */
export async function learnRule(tx: Database, owner: string, description: string, categoryId: string) {
  const pattern = ruleKey(description); if (pattern.length < CATEGORY_RULE_LIMITS.minimum) return;
  const rules = ((await preferencesOf(tx, owner))?.settings.categoryRules ?? []) as CategoryRule[];
  if (rules.some(rule => rule.source === 'user' && rule.pattern === pattern)) return;
  const existing = rules.find(rule => rule.source === 'learned' && rule.pattern === pattern);
  if (existing?.categoryId === categoryId) return;
  await writeRules(tx, owner, all => [...all.filter(rule => rule !== existing && !(rule.source === 'learned' && rule.pattern === pattern)),
    { id: existing?.id ?? randomUUID(), pattern, match: 'equals', source: 'learned', categoryId, updatedAt: new Date().toISOString() }]);
}
export async function saveUserRule(db: Database, owner: string, key: string, input: unknown) {
  const data = categoryRuleInputSchema.parse(input), pattern = ruleKey(data.pattern);
  if (pattern.length < CATEGORY_RULE_LIMITS.minimum) fail('INVALID_RULE', 400, 'Use ao menos três letras no texto da regra.');
  return operation(db, owner, key, 'save-category-rule', { pattern, categoryId: data.categoryId }, async tx => {
    await cardReference(tx, owner, 'categories', data.categoryId);
    const id = randomUUID();
    await writeRules(tx, owner, rules => [...rules.filter(rule => !(rule.source === 'user' && rule.pattern === pattern)), { id, pattern, match: 'contains', source: 'user', categoryId: data.categoryId, updatedAt: new Date().toISOString() }]);
    return { id };
  });
}
export async function deleteRule(db: Database, owner: string, key: string, id: string) {
  return operation(db, owner, key, 'delete-category-rule', { id }, async tx => {
    const rules = ((await preferencesOf(tx, owner))?.settings.categoryRules ?? []) as CategoryRule[];
    if (!rules.some(rule => rule.id === id)) fail('NOT_FOUND', 404, 'Regra não encontrada.');
    await writeRules(tx, owner, all => all.filter(rule => rule.id !== id));
    return { id };
  });
}
export interface SuggestionInput { position: number; description: string | null; amount: string | null }
/**
 * Suggestions for analysed rows: the user's rules first, then the local model for
 * the rest when configured. Archived categories are never proposed.
 */
export async function suggestImportCategories(db: Database, owner: string, rows: SuggestionInput[], config: AssistConfig | null = assistConfig(), fetcher?: typeof fetch) {
  const [rules, categories] = await Promise.all([categoryRules(db, owner), db.owned('categories', owner)]);
  const active = categories.filter(category => !category.archivedAt), names = new Map(active.map(category => [category.id, category.name]));
  const usable = rules.filter(rule => names.has(rule.categoryId)), suggestions = new Map<number, CategorySuggestion>();
  for (const row of rows) {
    const rule = row.description ? matchRule(usable, row.description) : null;
    if (rule) suggestions.set(row.position, { categoryId: rule.categoryId, source: 'rule', ruleId: rule.id,
      reason: rule.source === 'user' ? `Regra “contém ${rule.pattern}” criada por você.` : `Mesma descrição que você classificou como ${names.get(rule.categoryId)}.` });
  }
  const rest = rows.filter(row => row.description && !suggestions.has(row.position));
  if (!config || !rest.length) return { suggestions, warnings: [] as string[] };
  const model = await suggestCategories(config, rest.map(row => ({ position: row.position, description: row.description!, amount: row.amount })), active.map(category => ({ id: category.id, name: category.name })), fetcher);
  for (const [position, suggestion] of model.suggestions) suggestions.set(position, { categoryId: suggestion.categoryId, source: 'model', model: config.model,
    reason: `Sugestão do modelo local ${config.model}${suggestion.reason ? ': ' + suggestion.reason : ''}. Confira antes de salvar.` });
  return { suggestions, warnings: model.warning ? [model.warning] : [] };
}
