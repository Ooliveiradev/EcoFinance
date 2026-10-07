import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000';
test.setTimeout(90000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
const headers = () => ({ origin, 'idempotency-key': randomUUID() });
async function login(request: APIRequestContext, email = 'a@example.test') { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email, password: TEST_PASSWORD } })).status()).toBe(200); }
async function refs(request: APIRequestContext, name: string) {
  const a = await request.post('/api/accounts', { headers: headers(), data: { name, type: 'banco', openingBalance: '1000.00', openingDate: '2020-01-01' } });
  const c = await request.post('/api/categories', { headers: headers(), data: { name: 'Import ' + name, color: '#336699' } }); expect(a.status()).toBe(201); expect(c.status()).toBe(201);
  return { account: (await a.json()).id, category: (await c.json()).id };
}
test('uploads multiple files, corrects an invalid line, previews and commits selected items, then undoes after reload', async ({ page }, info) => {
  await login(page.request); const name = 'Import ' + info.project.name + ' ' + Date.now(), { account, category } = await refs(page.request, name);
  const filename = 'revisar-' + info.project.name + '.csv';
  await page.goto('/imports'); await page.getByLabel('Conta ou cartão de destino', { exact: true }).selectOption('account:' + account);
  await page.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles([
    { name: filename, mimeType: 'text/csv', buffer: Buffer.from('data;descricao;valor\n2026-10-01;Compra;-10.25\ninvalid;;bad') },
    { name: 'segundo.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from('data\tdescricao\tvalor\n2026-10-02\tSalário\t100.00') },
  ]);
  await page.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
  const batch = page.getByRole('article', { name: 'Lote ' + filename, exact: true }); await expect(batch).toContainText('Em revisão'); await expect(page.getByRole('article', { name: 'Lote segundo.tsv', exact: true })).toContainText('Em revisão');
  expect(await db.owned('transactions', '10000000-0000-4000-8000-000000000001', { where: [{ field: 'accountId', value: account }] })).toHaveLength(0);
  await batch.locator('summary').filter({ hasText: 'Linha 1 ·' }).click(); await batch.getByLabel('Categoria da linha 1', { exact: true }).selectOption(category); await batch.getByLabel('Selecionar linha 1', { exact: true }).check(); await batch.getByRole('button', { name: 'Salvar linha 1', exact: true }).click();
  await expect(batch.getByRole('region', { name: 'Prévia dos gráficos' })).toContainText('10,25');
  await batch.getByLabel('Descrição da linha 2', { exact: true }).fill('Corrigido'); await expect(batch.getByRole('button',{name:'Confirmar itens selecionados',exact:true})).toBeDisabled();await expect(batch.getByRole('status').filter({hasText:'correções não salvas'})).toBeVisible();await batch.getByLabel('Valor da linha 2', { exact: true }).fill('-1,25'); await batch.getByLabel('Data da linha 2', { exact: true }).fill('2026-10-03'); await batch.getByLabel('Competência da linha 2', { exact: true }).fill('2026-10'); await batch.getByLabel('Categoria da linha 2', { exact: true }).selectOption(category); await batch.getByRole('button', { name: 'Salvar linha 2', exact: true }).click();
  await batch.getByLabel('Revisei os itens selecionados, as duplicidades e o destino deste lote.', { exact: true }).check(); await batch.getByRole('button', { name: 'Confirmar itens selecionados', exact: true }).click(); await expect(batch).toContainText('Confirmado');
  const rows = await db.owned('transactions', '10000000-0000-4000-8000-000000000001', { where: [{ field: 'accountId', value: account }] }); expect(rows).toHaveLength(1); expect(rows[0]!.amount).toBe('-10.25');
  await page.screenshot({ path: 'test-results/imports-' + info.project.name + '.png', fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); const history = page.getByRole('region', { name: 'Histórico de importações' }); await history.locator('div').filter({ hasText: filename }).getByRole('button', { name: 'Abrir lote', exact: true }).click(); await batch.getByRole('button', { name: 'Desfazer lote', exact: true }).click(); await expect(batch).toContainText('Revertido'); expect((await db.get('transactions', rows[0]!.id))!.archivedAt).not.toBeNull();
});
test('denies foreign, hostile and legacy direct writes, persists file diagnostics and cancels without money changes', async ({ request, playwright }, info) => {
  expect((await request.get('/api/imports')).status()).toBe(401); expect((await request.post('/api/imports', { headers: headers(), data: {} })).status()).toBe(401);
  await login(request); const { account } = await refs(request, 'Errors ' + info.project.name + ' ' + Date.now());
  expect((await request.get('/api/imports/invalid')).status()).toBe(400);expect((await request.get('/api/imports?page=bad')).status()).toBe(400);
  const upload = await request.post('/api/imports', { headers: headers(), multipart: { accountId: account, files: { name: 'empty.ofx', mimeType: 'application/x-ofx', buffer: Buffer.alloc(0) } } }); expect(upload.status()).toBe(201); const received = (await upload.json()).batches[0];
  const analysis = await request.post('/api/imports/' + received.id + '/process', { headers: { ...headers(), 'if-match': received.revision }, data: {} }); expect(analysis.status()).toBe(200); const batch = await analysis.json(); expect(batch).toMatchObject({ state: 'failed' }); expect(batch.error).toContain('vazio');
  expect((await request.post('/api/transactions/import-ofx', { headers: headers(), data: {} })).status()).toBe(400);
  expect((await request.post('/api/imports/' + received.id + '/cancel', { headers: { ...headers(), origin: 'https://hostile.test', 'if-match': batch.revision }, data: {} })).status()).toBe(403);
  const foreign = await playwright.request.newContext(); await login(foreign, 'b@example.test'); try { expect((await foreign.get('/api/imports/' + batch.id)).status()).toBe(404); expect((await foreign.post('/api/imports/' + batch.id + '/cancel', { headers: { ...headers(), 'if-match': batch.revision }, data: {} })).status()).toBe(404); } finally { await foreign.dispose(); }
  expect((await request.post('/api/imports/' + batch.id + '/cancel', { headers: { ...headers(), 'if-match': batch.revision }, data: {} })).status()).toBe(200);
});
