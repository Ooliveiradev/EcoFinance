import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';

/** Category rules (#11): written in settings, pre-selected in review, applied only when the row is saved. */
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000';
test.setTimeout(120000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
const headers = () => ({ origin, 'idempotency-key': randomUUID() });
async function login(request: APIRequestContext) { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD } })).status()).toBe(200); }
test('a settings rule pre-selects the category of matching imported rows', async ({ page }, info) => {
  await login(page.request); const run = info.project.name + '-' + Date.now();
  const account = await page.request.post('/api/accounts', { headers: headers(), data: { name: 'Regras ' + run, type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' } });
  const category = await page.request.post('/api/categories', { headers: headers(), data: { name: 'Feira ' + run, color: '#336699' } });
  expect(account.status()).toBe(201); expect(category.status()).toBe(201);
  await page.goto('/settings');
  const rules = page.getByRole('region', { name: 'Regras de categoria' });
  await expect(rules).toContainText('Assistente por modelo local desligado');
  await rules.getByLabel('Descrição contém', { exact: true }).fill('Hortifruti ' + run.replace(/[^a-z]/gi, ''));
  await rules.getByLabel('Categoria da regra', { exact: true }).selectOption({ label: 'Feira ' + run });
  await rules.getByRole('button', { name: 'Adicionar regra', exact: true }).click();
  await expect(rules.getByRole('status')).toContainText('Regra salva.');
  await expect(rules.getByRole('list', { name: 'Regras de categoria' })).toContainText('criada por você');

  await page.goto('/imports');
  const main = page.getByRole('main'), name = `regras-${run}.csv`;
  await main.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true }).selectOption('account:' + (await account.json()).id);
  await main.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(`Data;Descrição;Valor\n25/10/2026;HORTIFRUTI ${run.replace(/[^a-z]/gi, '')} 12;-14,90\n`) });
  await page.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
  const batch = page.getByRole('article', { name: 'Lote ' + name, exact: true });
  await expect(batch).toContainText('Em revisão');
  await batch.locator('summary').filter({ hasText: 'Linha 1 ·' }).click();
  await expect(batch.getByLabel('Categoria da linha 1', { exact: true })).toHaveValue((await category.json()).id);
  await expect(batch).toContainText('Ela só vale depois de salvar a linha.');
  // Still a pending row: nothing is categorized until the user saves it.
  await expect(batch.locator('summary').filter({ hasText: 'Linha 1 ·' })).toContainText('Categoria a revisar');
});
