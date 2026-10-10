import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { invoicePages, picture, protectedPdf, receiptPage, textPdf } from '../fixtures/documents/build';

/** PDF and photo imports (#10): extraction on the server, page evidence and the password prompt. */
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000';
test.setTimeout(120000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
const headers = () => ({ origin, 'idempotency-key': randomUUID() });
async function login(request: APIRequestContext) { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD } })).status()).toBe(200); }
async function card(request: APIRequestContext, name: string) {
  const account = await request.post('/api/accounts', { headers: headers(), data: { name, type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' } }); expect(account.status()).toBe(201);
  const created = await request.post('/api/cards', { headers: headers(), data: { name: 'Cartão ' + name, paymentAccountId: (await account.json()).id, closingDay: 25, dueDay: 5 } }); expect(created.status()).toBe(201);
  return (await created.json()).id as string;
}
async function upload(page: Page, target: string, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto('/imports');
  const main = page.getByRole('main'), destination = main.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true });
  await destination.selectOption(target); await expect(destination).toHaveValue(target);
  await main.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles(files);
  await page.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
}
test('reads a digital invoice, a receipt photo and a protected PDF with explicit review', async ({ page }, info) => {
  await login(page.request); const run = info.project.name + '-' + Date.now(), target = 'card:' + await card(page.request, 'Documentos ' + run);
  const pdfKey = 'senha-' + run;
  const names = { invoice: `fatura-${run}.pdf`, receipt: `comprovante-${run}.png`, locked: `protegida-${run}.pdf` };
  await upload(page, target, [
    { name: names.invoice, mimeType: 'application/pdf', buffer: Buffer.from(await textPdf(invoicePages)) },
    { name: names.receipt, mimeType: 'image/png', buffer: Buffer.from(await picture(receiptPage, 'png')) },
    { name: names.locked, mimeType: 'application/pdf', buffer: Buffer.from(protectedPdf(['FATURA DO CARTAO', 'Vencimento 10/10/2026', 'Data Descricao Valor', '12/09 MERCADO EXEMPLO 45,90'], pdfKey)) },
  ]);
  const batch = (name: string) => page.getByRole('article', { name: 'Lote ' + name, exact: true });
  await expect(batch(names.invoice)).toContainText('PDF digital · fatura de cartão · Em revisão');
  await batch(names.invoice).locator('summary').filter({ hasText: 'Linha 4 ·' }).click();
  await expect(batch(names.invoice)).toContainText('página 2');
  await expect(batch(names.invoice)).toContainText('texto do PDF');
  await expect(batch(names.invoice)).toContainText('pagamento(s) de fatura ficaram fora da revisão');
  await expect(batch(names.receipt)).toContainText('(OCR) · comprovante · Em revisão');
  await expect(batch(names.receipt)).toContainText('PADARIA EXEMPLO LTDA');
  const locked = batch(names.locked);
  await expect(locked.getByRole('alert')).toContainText('PDF protegido por senha');
  await locked.getByLabel('Senha do PDF ' + names.locked, { exact: true }).fill('errada');
  await locked.getByRole('button', { name: 'Analisar com a senha', exact: true }).click();
  await expect(locked.getByRole('alert')).toContainText('Senha do PDF incorreta');
  await locked.getByLabel('Senha do PDF ' + names.locked, { exact: true }).fill(pdfKey);
  await locked.getByRole('button', { name: 'Analisar com a senha', exact: true }).click();
  await expect(locked).toContainText('PDF digital · fatura de cartão · Em revisão');
  await expect(locked).toContainText('MERCADO EXEMPLO');
  // Nothing about the password is kept in the batch the browser can read back.
  const listed = await page.request.get('/api/imports'); expect(await listed.text()).not.toContain(pdfKey);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
