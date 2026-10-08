import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { corpus, corpusBytes } from '../fixtures/imports/corpus';
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000', owner = '10000000-0000-4000-8000-000000000001';
test.setTimeout(120000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
const headers = () => ({ origin, 'idempotency-key': randomUUID() });
async function login(request: APIRequestContext) { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD } })).status()).toBe(200); }
async function refs(request: APIRequestContext, name: string) {
  const a = await request.post('/api/accounts', { headers: headers(), data: { name, type: 'banco', openingBalance: '0.00', openingDate: '2020-01-01' } });
  const c = await request.post('/api/categories', { headers: headers(), data: { name: 'Formatos ' + name, color: '#336699' } }); expect(a.status()).toBe(201); expect(c.status()).toBe(201);
  return { account: (await a.json()).id as string, category: (await c.json()).id as string };
}
const fixture = (file: string, name = file) => ({ name, mimeType: corpus.find(entry => entry.file === file)!.mime, buffer: Buffer.from(corpusBytes(file)) });
async function upload(page: Page, account: string, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto('/imports');
  const main = page.getByRole('main'), destination = main.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true });
  await expect(destination).toHaveCount(1); await destination.selectOption('account:' + account); await expect(destination).toHaveValue('account:' + account);
  await main.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles(files);
  await page.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
}
test('reviews OFX, CSV/TSV in legacy encodings, XLSX and XLS with cell evidence, then confirms a spreadsheet', async ({ page }, info) => {
  await login(page.request); const run = info.project.name + '-' + Date.now(), { account, category } = await refs(page.request, 'Formatos ' + run);
  const names = { ofx: `cartao-${run}.ofx`, csv: `banco-${run}.csv`, tsv: `unicode-${run}.txt`, xlsx: `pasta-${run}.xlsx`, xls: `legado-${run}.xls` };
  await upload(page, account, [fixture('ofx-xml-card.ofx', names.ofx), fixture('csv-banco-1252.csv', names.csv), fixture('tsv-utf16le.txt', names.tsv), fixture('xlsx-multi-sheet.xlsx', names.xlsx), fixture('xls-biff8.xls', names.xls)]);
  const batch = (name: string) => page.getByRole('article', { name: 'Lote ' + name, exact: true });
  for (const [name, format] of [[names.ofx, 'OFX XML'], [names.csv, 'CSV/TSV · ponto e vírgula · Windows-1252'], [names.tsv, 'CSV/TSV · tabulação · UTF-16 LE'], [names.xlsx, 'XLSX · aba Extrato Out'], [names.xls, 'XLS · aba Extrato']] as const)
    await expect(batch(name)).toContainText(format + ' · Em revisão');
  await expect(batch(names.csv)).toContainText('Supermercado Exemplo – Unidade 3');
  await batch(names.xlsx).locator('summary').filter({ hasText: 'Linha 3 ·' }).click();
  await expect(batch(names.xlsx)).toContainText("célula 'Extrato Out'!C6");
  await expect(batch(names.xlsx)).toContainText('fórmula; usado o valor salvo');
  await expect(batch(names.xlsx).locator('summary').filter({ hasText: 'Linha 6 ·' })).toContainText('Inválida');
  expect(await db.owned('transactions', owner, { where: [{ field: 'accountId', value: account }] })).toHaveLength(0);
  const xls = batch(names.xls);
  for (const line of [1, 2, 3]) {
    await xls.locator('summary').filter({ hasText: `Linha ${line} ·` }).click();
    await xls.getByLabel(`Categoria da linha ${line}`, { exact: true }).selectOption(category); await xls.getByLabel(`Selecionar linha ${line}`, { exact: true }).check();
    await xls.getByRole('button', { name: `Salvar linha ${line}`, exact: true }).click(); await expect(xls.locator('summary').filter({ hasText: `Linha ${line} ·` })).toContainText('Selecionada');
  }
  await xls.getByLabel('Revisei os itens selecionados, as duplicidades e o destino deste lote.', { exact: true }).check();
  await xls.getByRole('button', { name: 'Confirmar itens selecionados', exact: true }).click(); await expect(xls).toContainText('Confirmado');
  const rows = await db.owned('transactions', owner, { where: [{ field: 'accountId', value: account }] });
  expect(rows.map(row => row.amount).sort()).toEqual(['-0.01', '-150.75', '2000.00']); expect(new Set(rows.map(row => row.source))).toEqual(new Set(['spreadsheet']));
  await page.screenshot({ path: 'test-results/import-formats-' + info.project.name + '.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('asks for assisted mapping on ambiguous dates and tabs, and reports hostile spreadsheets', async ({ page }, info) => {
  await login(page.request); const run = info.project.name + '-' + Date.now(), { account } = await refs(page.request, 'Mapeamento ' + run);
  // A unique extra column keeps this run's layout fingerprint free of earlier saved profiles.
  const csv = { name: `datas-${run}.csv`, mimeType: 'text/csv', buffer: Buffer.from(`data;descricao;valor;ref ${run}\n01/02/2026;Mercado;-10,00;a\n03/04/2026;Farmácia;-20,50;b\n`) };
  const tabs = `abas-${run}.xlsx`, bomb = `bomba-${run}.xlsx`, locked = `senha-${run}.xlsx`;
  await upload(page, account, [csv, fixture('xlsx-two-statements.xlsx', tabs), fixture('xlsx-zip-bomb.xlsx', bomb), fixture('xlsx-encrypted.xlsx', locked)]);
  const batch = (name: string) => page.getByRole('article', { name: 'Lote ' + name, exact: true });
  await expect(batch(bomb)).toContainText('zip bomb'); await expect(batch(locked)).toContainText('protegida por senha');
  for (const name of [bomb, locked]) await expect(batch(name).getByRole('button', { name: 'Aplicar mapeamento' })).toHaveCount(0);
  const dates = batch(csv.name);
  await expect(dates.getByRole('alert')).toContainText('Datas ambíguas');
  await expect(dates.getByRole('table', { name: 'Amostra de ' + csv.name })).toContainText('Farmácia');
  await dates.getByLabel('Ordem das datas', { exact: true }).selectOption('dmy');
  await dates.getByRole('button', { name: 'Aplicar mapeamento', exact: true }).click();
  await expect(dates).toContainText('Em revisão');
  await dates.locator('summary').filter({ hasText: 'Linha 1 ·' }).click(); await expect(dates.getByLabel('Data da linha 1', { exact: true })).toHaveValue('2026-02-01');
  const workbook = batch(tabs);
  await expect(workbook.getByRole('alert')).toContainText('2 abas');
  await workbook.getByLabel('Aba da planilha', { exact: true }).selectOption('Cartão');
  await workbook.getByLabel('Salvar mapeamento para este layout', { exact: true }).uncheck();
  await workbook.getByRole('button', { name: 'Aplicar mapeamento', exact: true }).click();
  await expect(workbook).toContainText('XLSX · aba Cartão · Em revisão');
  await workbook.locator('summary').filter({ hasText: 'Linha 1 ·' }).click(); await expect(workbook).toContainText("célula 'Cartão'!C2");
  // The remembered date order applies to the next file with the same layout.
  await upload(page, account, [{ ...csv, name: `datas-2-${run}.csv` }]);
  await expect(batch(`datas-2-${run}.csv`)).toContainText('Em revisão');
  expect(await db.owned('transactions', owner, { where: [{ field: 'accountId', value: account }] })).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
