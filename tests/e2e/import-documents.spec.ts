import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { documentBytes, documentCorpus, DOCUMENT_PASSWORD } from '../fixtures/documents/corpus';
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000', owner = '10000000-0000-4000-8000-000000000001';
// OCR runs on the server under test; each project waits for real extraction.
test.setTimeout(240000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
const headers = () => ({ origin, 'idempotency-key': randomUUID() });
async function login(request: APIRequestContext) { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD } })).status()).toBe(200); }
async function refs(request: APIRequestContext, name: string) {
  const a = await request.post('/api/accounts', { headers: headers(), data: { name, type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' } });
  const c = await request.post('/api/categories', { headers: headers(), data: { name: 'Documentos ' + name, color: '#336699' } }); expect(a.status()).toBe(201); expect(c.status()).toBe(201);
  return { account: (await a.json()).id as string, category: (await c.json()).id as string };
}
const fixture = async (file: string, name: string) => ({ name, mimeType: documentCorpus.find(entry => entry.file === file)!.mime, buffer: Buffer.from(await documentBytes(file)) });
async function upload(page: Page, account: string, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto('/imports');
  const main = page.getByRole('main'), destination = main.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true });
  await expect(destination).toHaveCount(1); await destination.selectOption('account:' + account); await expect(destination).toHaveValue('account:' + account);
  await main.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles(files);
  await page.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
}
const batchOf = (page: Page, name: string) => page.getByRole('article', { name: 'Lote ' + name, exact: true });

test('analyses digital and scanned PDFs and a photo off the request, with page and region evidence, then confirms the receipt', async ({ page }, info) => {
  await login(page.request); const run = info.project.name + '-' + Date.now(), { account, category } = await refs(page.request, 'Documentos ' + run);
  const names = { digital: `extrato-${run}.pdf`, scan: `escaneado-${run}.pdf`, photo: `comprovante-${run}.png` };
  await upload(page, account, [await fixture('extrato-digital.pdf', names.digital), await fixture('extrato-escaneado.pdf', names.scan), await fixture('comprovante-pix.png', names.photo)]);
  for (const [name, format] of [[names.digital, 'PDF digital · extrato'], [names.scan, 'PDF escaneado (OCR) · extrato'], [names.photo, 'Imagem PNG (OCR) · comprovante']] as const)
    await expect(batchOf(page, name)).toContainText(format + ' · Em revisão', { timeout: 120000 });
  const digital = batchOf(page, names.digital);
  await expect(digital).toContainText('2 página(s)');
  await digital.locator('summary').filter({ hasText: 'Linha 3 ·' }).click();
  await expect(digital).toContainText('Pagamento boleto Energia Distribuidora Fictícia ref. 10/2026');
  await expect(digital).toContainText('página 1 · linha 9 · região');
  const scan = batchOf(page, names.scan);
  await scan.locator('summary').filter({ hasText: 'Linha 4 ·' }).click();
  await expect(scan).toContainText('página 2'); await expect(scan).toContainText('confiança do OCR');
  await expect(scan).toContainText('Farmácia Popular Exemplo');
  expect(await db.owned('transactions', owner, { where: [{ field: 'accountId', value: account }] })).toHaveLength(0);
  const receipt = batchOf(page, names.photo);
  await receipt.locator('summary').filter({ hasText: 'Linha 1 ·' }).click();
  await expect(receipt.getByLabel('Valor da linha 1', { exact: true })).toHaveValue('-85.00');
  await receipt.getByLabel('Categoria da linha 1', { exact: true }).selectOption(category); await receipt.getByLabel('Selecionar linha 1', { exact: true }).check();
  await receipt.getByRole('button', { name: 'Salvar linha 1', exact: true }).click(); await expect(receipt.locator('summary').filter({ hasText: 'Linha 1 ·' })).toContainText('Selecionada');
  await receipt.getByLabel('Revisei os itens selecionados, as duplicidades e o destino deste lote.', { exact: true }).check();
  await receipt.getByRole('button', { name: 'Confirmar itens selecionados', exact: true }).click(); await expect(receipt).toContainText('Confirmado');
  const rows = await db.owned('transactions', owner, { where: [{ field: 'accountId', value: account }] });
  expect(rows.map(row => [row.amount, row.purchaseDate, row.description, row.source])).toEqual([['-85.00', '2026-10-14', 'Padaria Exemplo Ltda', 'document']]);
  await page.screenshot({ path: 'test-results/import-documents-' + info.project.name + '.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('shows progress and cancels a running OCR, and asks for a PDF password without storing it', async ({ page }, info) => {
  await login(page.request); const run = info.project.name + '-' + Date.now(), { account } = await refs(page.request, 'Senha ' + run);
  const scanName = `escaneado-${run}.pdf`, lockedName = `protegido-${run}.pdf`;
  await upload(page, account, [await fixture('extrato-escaneado.pdf', scanName), await fixture('extrato-protegido.pdf', lockedName)]);
  const scan = batchOf(page, scanName), locked = batchOf(page, lockedName);
  await expect(scan.getByRole('status')).toContainText(/Reconhecendo texto \(OCR\)|Lendo o texto do PDF|Na fila/, { timeout: 30000 });
  await scan.getByRole('button', { name: 'Cancelar lote', exact: true }).click();
  await expect(scan).toContainText('Cancelado');
  await expect(locked.getByRole('alert')).toContainText('PDF protegido por senha', { timeout: 60000 });
  const field = locked.getByLabel('Senha do PDF ' + lockedName, { exact: true });
  await field.fill('Senha-Errada-0000'); await locked.getByRole('button', { name: 'Analisar com senha', exact: true }).click();
  await expect(locked.getByRole('alert')).toContainText('Senha incorreta', { timeout: 60000 });
  await field.fill(DOCUMENT_PASSWORD); await locked.getByRole('button', { name: 'Analisar com senha', exact: true }).click();
  await expect(locked).toContainText('PDF digital · extrato · Em revisão', { timeout: 60000 });
  await locked.locator('summary').filter({ hasText: 'Linha 2 ·' }).click(); await expect(locked).toContainText('Transferência recebida');
  const stored = JSON.stringify(await db.owned('importBatches', owner));
  expect(stored).not.toContain(DOCUMENT_PASSWORD); expect(stored).not.toContain('Senha-Errada-0000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
