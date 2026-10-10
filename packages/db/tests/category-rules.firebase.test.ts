import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { testStore, clearTestCollections } from './firestore-fixture';
import { saveAccount, saveCategory, archiveReference } from '../../../apps/next/src/lib/manual-finance-service';
import { receiveImports, processImport, reviewImportItem } from '../../../apps/next/src/lib/import-store';
import { categoryRules, deleteRule, saveUserRule, suggestImportCategories } from '../../../apps/next/src/lib/category-rules';
import type { ImportBatchView } from '../../shared/src';

/** Category assistance (#11): rules learned in review, user rules and the local model, never auto-applied. */
const db = testStore('category-rules-' + randomBytes(6).toString('hex'));
const owner = '10000000-0000-4000-8000-000000000001';
let account: string, food: string, transport: string;
beforeAll(async () => { await clearTestCollections(db); });
beforeEach(async () => {
  await clearTestCollections(db);
  const now = new Date();
  await db.put('users', { id: owner, displayName: 'Synthetic', email: null, emailVerified: false, image: null, createdAt: now, updatedAt: now });
  account = String((await saveAccount(db, owner, randomUUID(), { name: 'Regras', type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' })).id);
  food = String((await saveCategory(db, owner, randomUUID(), { name: 'Alimentação', color: '#336699' })).id);
  transport = String((await saveCategory(db, owner, randomUUID(), { name: 'Transporte', color: '#993366' })).id);
});
afterAll(async () => { await clearTestCollections(db); await db.firestore.terminate(); });
const csv = (lines: string[]) => ({ name: randomUUID() + '.csv', mime: 'text/csv', bytes: new TextEncoder().encode(['Data;Descrição;Valor', ...lines].join('\n') + '\n') });
async function analyse(lines: string[]): Promise<ImportBatchView> {
  const received = await receiveImports(db, owner, randomUUID(), [csv(lines)], { accountId: account, cardId: null });
  const batch = (received.batches as { id: string; revision: string }[])[0]!;
  return processImport(db, owner, batch.id, batch.revision);
}

it('learns the reviewed category and pre-selects it next time without categorizing the row', async () => {
  const first = await analyse(['25/10/2026;PIX PADARIA EXEMPLO 123;-12,00']);
  expect(first.rows[0]!.suggestion).toBeNull();
  const row = first.rows[0]!;
  await reviewImportItem(db, owner, randomUUID(), first.id, row.id, row.revision, { description: row.description, amount: row.amount, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, categoryId: food, selected: true, resolution: 'new', duplicateId: null });
  expect(await categoryRules(db, owner)).toMatchObject([{ pattern: 'pix padaria exemplo', match: 'equals', source: 'learned', categoryId: food }]);
  const second = await analyse(['26/10/2026;PIX PADARIA EXEMPLO 987;-8,00', '27/10/2026;UBER VIAGEM;-30,00']);
  expect(second.rows[0]).toMatchObject({ categoryId: null, state: 'pending', selected: false, suggestion: { categoryId: food, source: 'rule' } });
  expect(second.rows[0]!.suggestion!.reason).toContain('Alimentação');
  expect(second.rows[1]!.suggestion).toBeNull();
});
it('lets user rules win, ignores archived categories and deletes rules', async () => {
  const { id } = await saveUserRule(db, owner, randomUUID(), { pattern: 'Uber', categoryId: transport });
  await expect(saveUserRule(db, owner, randomUUID(), { pattern: '12 3', categoryId: transport })).rejects.toMatchObject({ code: 'INVALID_RULE' });
  const batch = await analyse(['27/10/2026;UBER VIAGEM CENTRO;-30,00']);
  expect(batch.rows[0]!.suggestion).toMatchObject({ categoryId: transport, source: 'rule', reason: 'Regra “contém uber” criada por você.' });
  // A review choosing another category does not overwrite the user's rule.
  const row = batch.rows[0]!;
  await reviewImportItem(db, owner, randomUUID(), batch.id, row.id, row.revision, { description: 'UBER', amount: row.amount, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, categoryId: food, selected: true, resolution: 'new', duplicateId: null });
  expect((await categoryRules(db, owner)).filter(rule => rule.pattern === 'uber').map(rule => rule.source)).toEqual(['user']);
  const category = (await db.get('categories', transport))!;
  await archiveReference(db, owner, randomUUID(), 'categories', transport, category.revision!, true);
  expect((await analyse(['28/10/2026;UBER VIAGEM;-9,00'])).rows[0]!.suggestion).toBeNull();
  await deleteRule(db, owner, randomUUID(), String(id));
  expect((await categoryRules(db, owner)).some(rule => rule.id === id)).toBe(false);
  await expect(deleteRule(db, owner, randomUUID(), String(id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
it('asks the local model only for rows without a rule and keeps the manual flow when it fails', async () => {
  await saveUserRule(db, owner, randomUUID(), { pattern: 'padaria', categoryId: food });
  const asked: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); asked.push(body.messages[1].content);
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ sugestoes: [{ n: 1, categoria: 'c2', motivo: 'Corrida de aplicativo' }] }) } }));
  }) as unknown as typeof fetch;
  const config = { url: 'http://ollama.test', model: 'qwen2.5:3b', timeoutMs: 1000 };
  const result = await suggestImportCategories(db, owner, [{ position: 1, description: 'PADARIA CENTRAL', amount: '-5.00' }, { position: 2, description: 'UBER VIAGEM', amount: '-30.00' }], config, fetcher);
  expect(result.suggestions.get(1)).toMatchObject({ source: 'rule', categoryId: food });
  expect(result.suggestions.get(2)).toMatchObject({ source: 'model', categoryId: transport, model: 'qwen2.5:3b' });
  expect(result.suggestions.get(2)!.reason).toContain('Corrida de aplicativo');
  expect(asked).toHaveLength(1); expect(asked[0]).not.toContain('PADARIA');
  const down = await suggestImportCategories(db, owner, [{ position: 1, description: 'UBER', amount: '-1.00' }], config, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch);
  expect(down.suggestions.size).toBe(0); expect(down.warnings[0]).toContain('indisponível');
});
