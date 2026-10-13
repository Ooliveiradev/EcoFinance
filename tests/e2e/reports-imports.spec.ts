import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { formatCents, moneyToCents } from '../../packages/shared/src';
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000', email = 'd@example.test';
// Dedicated owner (global-setup): other specs leave batches in review for their owners.
async function ownerId() { return (await db.query('users', { where: [{ field: 'email', value: email }], limit: 1 }))[0]!.id; }
test.setTimeout(120000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
const headers = (extra: Record<string, string> = {}) => ({ origin, 'idempotency-key': randomUUID(), ...extra });
async function login(request: APIRequestContext) { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email, password: TEST_PASSWORD } })).status()).toBe(200); }
async function created(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(path, { headers: headers(), data }); expect(response.status()).toBe(201); return (await response.json()).id as string;
}
/** A failed earlier run must not leave batches in review that change the notice under test. */
async function cancelReviews(request: APIRequestContext) {
  for (const batch of await db.owned('importBatches', await ownerId(), { where: [{ field: 'state', value: 'review' }] }))
    expect((await request.post(`/api/imports/${batch.id}/cancel`, { headers: headers({ 'if-match': batch.revision! }), data: {} })).status()).toBe(200);
}

interface Expected { income: string; expenses: string; count: number; pending: number }
/** API, summary, CSV, /reports and "Meu mês" all show the same numbers for the month. */
async function everySurface(page: Page, month: string, expected: Expected) {
  const api = await (await page.request.get(`/api/reports?from=${month}&to=${month}`)).json();
  expect(api.report.months[0]).toMatchObject({ income: expected.income, expenses: expected.expenses, count: expected.count });
  expect(api.pendingImports).toBe(expected.pending);
  const summary = await (await page.request.get(`/api/months/${month}/summary`)).json();
  expect(summary).toMatchObject({ income: expected.income, expenses: expected.expenses, entriesCount: expected.count, projection: api.projection });
  const csv = await (await page.request.get(`/api/reports/export?from=${month}&to=${month}&basis=competence`)).text();
  for (const [key, value] of [['income', expected.income], ['expenses', expected.expenses], ['count', expected.count]] as const) expect(csv).toContain(`mensal;${month};competência;${key};${value}`);
  const money = (value: string) => formatCents(moneyToCents(value));
  const notice = (scope: Locator) => expected.pending
    ? expect(scope.getByTestId('pending-imports')).toContainText(`${expected.pending} lote de importação em revisão`)
    : expect(scope.getByTestId('pending-imports')).toHaveCount(0);

  await page.goto(`/reports?de=${month}&ate=${month}`);
  const reports = page.getByRole('main'), monthly = reports.getByRole('table', { name: /Totais mensais/ });
  await expect(monthly.getByRole('row').nth(1)).toContainText(money(expected.income));
  await expect(monthly.getByRole('row').nth(1)).toContainText(money(expected.expenses));
  await expect(monthly.getByRole('row').nth(1)).toContainText(String(expected.count));
  await notice(reports);

  await page.goto('/?mes=' + month);
  const dashboard = page.getByRole('main'), summaryRegion = dashboard.getByRole('region', { name: 'Resumo financeiro do mês' });
  await expect(summaryRegion).toContainText(money(expected.income));
  await expect(summaryRegion).toContainText(money(expected.expenses));
  await expect(dashboard.getByTestId('projection-formula')).toContainText(`saldo atual ${api.projection.balance === null ? 'indisponível' : money(api.projection.balance)}`);
  await notice(dashboard);
}

test('import preview stays out of confirmed numbers; confirm, correction and undo update dashboard, reports, summary and CSV', async ({ page }, info) => {
  await login(page.request); await cancelReviews(page.request);
  // One competence per browser project: the owner is shared across projects.
  const month = ({ chromium: '2032-01', webkit: '2032-03', 'mobile-web': '2032-05' })[info.project.name]!, name = 'Importação ' + info.project.name + ' ' + Date.now();
  const account = await created(page.request, '/api/accounts', { name, type: 'banco', openingBalance: '0.00', openingDate: month + '-01' });
  const category = await created(page.request, '/api/categories', { name, color: '#336699' });
  await everySurface(page, month, { income: '0.00', expenses: '0.00', count: 0, pending: 0 });

  // Upload through the real pipeline (multipart → analysis → review).
  const filename = `relatorio-${info.project.name}.csv`;
  await page.goto('/imports');
  const imports = page.getByRole('main'), destination = imports.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true });
  await destination.selectOption('account:' + account); await expect(destination).toHaveValue('account:' + account);
  await imports.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles([{ name: filename, mimeType: 'text/csv', buffer: Buffer.from(`data;descricao;valor\n${month}-03;Mercado ${name};-10.25\n${month}-05;Salário ${name};100.00\n${month}-07;Tarifa ${name};-2.00\n`) }]);
  await imports.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
  const batch = imports.getByRole('article', { name: 'Lote ' + filename, exact: true }); await expect(batch).toContainText('Em revisão');
  for (const line of [1, 2, 3]) {
    await batch.locator('summary').filter({ hasText: `Linha ${line} ·` }).click();
    // Correction before commit: the fee was 3,50, not 2,00.
    if (line === 3) await batch.getByLabel('Valor da linha 3', { exact: true }).fill('-3,50');
    await batch.getByLabel(`Categoria da linha ${line}`, { exact: true }).selectOption(category); await batch.getByLabel(`Selecionar linha ${line}`, { exact: true }).check();
    await batch.getByRole('button', { name: `Salvar linha ${line}`, exact: true }).click(); await expect(batch.locator('summary').filter({ hasText: `Linha ${line} ·` })).toContainText('Selecionada');
  }
  const preview = batch.getByRole('region', { name: 'Prévia dos gráficos' });
  await expect(preview).toContainText('Receitas R$ 100,00'); await expect(preview).toContainText('Despesas líquidas R$ 13,75');
  // The preview lives only in the batch: nothing confirmed moved.
  await everySurface(page, month, { income: '0.00', expenses: '0.00', count: 0, pending: 1 });

  await page.goto('/imports');
  await page.getByRole('region', { name: 'Histórico de importações' }).locator('div').filter({ hasText: filename }).getByRole('button', { name: 'Abrir lote', exact: true }).click();
  await batch.getByLabel('Revisei os itens selecionados, as duplicidades e o destino deste lote.', { exact: true }).check();
  await batch.getByRole('button', { name: 'Confirmar itens selecionados', exact: true }).click(); await expect(batch).toContainText('Confirmado');
  await everySurface(page, month, { income: '100.00', expenses: '13.75', count: 3, pending: 0 });
  await expect(page.getByRole('main').getByRole('table', { name: /Detalhamento de despesas por categoria/ })).toContainText('100,0%');

  // Correction after commit, through the entries API.
  const market = (await db.owned('transactions', await ownerId(), { where: [{ field: 'accountId', value: account }] })).find(row => row.amount === '-10.25')!;
  expect((await page.request.patch('/api/entries/' + market.id, { headers: headers({ 'if-match': '"' + market.revision + '"' }), data: { accountId: account, categoryId: category, toAccountId: null, description: market.description, amount: '12.00', kind: 'expense', status: 'settled', purchaseDate: market.purchaseDate, competenceMonth: market.competenceMonth, dueDate: null, paidDate: market.paidDate, notes: null } })).status()).toBe(200);
  await everySurface(page, month, { income: '100.00', expenses: '15.50', count: 3, pending: 0 });

  // Undo: the edited entry is preserved, the other two leave every surface.
  await page.goto('/imports');
  await page.getByRole('region', { name: 'Histórico de importações' }).locator('div').filter({ hasText: filename }).getByRole('button', { name: 'Abrir lote', exact: true }).click();
  await batch.getByRole('button', { name: 'Desfazer lote', exact: true }).click(); await expect(batch).toContainText('Revertido');
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Lote revertido' })).toContainText('2 arquivado(s), 1 preservado(s)');
  await everySurface(page, month, { income: '0.00', expenses: '12.00', count: 1, pending: 0 });
});

test('the dashboard is rendered once while the streamed page is revealed', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling needs the Chrome DevTools Protocol.');
  await login(page.request);
  // Count every copy (visible or hidden) of the projection formula as the page streams in.
  await page.addInitScript(() => {
    const state = window as unknown as { formulaCopies: number };
    state.formulaCopies = 0;
    new MutationObserver(() => { state.formulaCopies = Math.max(state.formulaCopies, document.querySelectorAll('[data-testid="projection-formula"]').length); })
      .observe(document, { subtree: true, childList: true });
  });
  // A slow CPU widens the window between streaming and reveal, as on CI runners.
  await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (let run = 0; run < 3; run++) {
    await page.goto('/?mes=2032-01'); await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('projection-formula')).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { formulaCopies: number }).formulaCopies)).toBe(1);
  }
});
