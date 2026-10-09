import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { formatCents, moneyToCents } from '../../packages/shared/src';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';

const db = e2eDatabase(), origin = 'http://127.0.0.1:3000';
const headers = () => ({ origin, 'idempotency-key': randomUUID() });
test.setTimeout(180000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });

async function create(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(path, { headers: headers(), data });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

async function checkReports(page: Page, month: string, category: string, income: string, expenses: string) {
  const money = (value: string) => formatCents(moneyToCents(value));
  for (const basis of ['competence', 'cash'] as const) {
    const response = await page.request.get(`/api/reports?from=${month}&to=${month}&basis=${basis}`);
    expect(response.status()).toBe(200);
    const { report } = await response.json();
    expect(report.totals).toMatchObject({ income, expenses });
    expect(report.categories).toEqual([expect.objectContaining({ name: category, amount: expenses })]);

    await page.goto(`/reports?de=${month}&ate=${month}&base=${basis}`);
    const main = page.getByRole('main');
    const totals = main.getByRole('region', { name: 'Totais do período' });
    await expect(totals.locator('dd').nth(0)).toHaveText(money(income));
    await expect(totals.locator('dd').nth(1)).toHaveText(money(expenses));
    const monthly = main.getByRole('table', { name: /Totais mensais/ });
    await expect(monthly.getByRole('cell', { name: money(income), exact: true })).toHaveCount(2);
    await expect(monthly.getByRole('cell', { name: money(expenses), exact: true }).first()).toBeVisible();
    await expect(main.getByRole('table', { name: 'Despesas por categoria no período' }).getByRole('cell', { name: money(expenses), exact: true })).toBeVisible();

    // Keyboard interaction also checks the actual chart tooltip's exact labels,
    // rather than merely inspecting the shared API or the adjacent table.
    const incomeLabel = basis === 'competence' ? 'Receitas' : 'Entradas';
    const expenseLabel = basis === 'competence' ? 'Despesas' : 'Saídas';
    const chart = main.getByRole('application', { name: `Gráfico de ${incomeLabel.toLowerCase()} e ${expenseLabel.toLowerCase()} por mês` });
    await chart.focus();
    await page.keyboard.press('ArrowRight');
    await expect(main.getByText(`${incomeLabel}: ${money(income)}`, { exact: true })).toBeVisible();
    await expect(main.getByText(`${expenseLabel}: ${money(expenses)}`, { exact: true })).toBeVisible();

    const split = main.getByRole('application', { name: 'Gráfico de despesas fixas e variáveis por mês' });
    await split.focus();
    await page.keyboard.press('ArrowRight');
    await expect(main.getByText('Fixos: R$ 0,00', { exact: true })).toBeVisible();
    await expect(main.getByText(`Variáveis: ${money(expenses)}`, { exact: true })).toBeVisible();

    const planning = main.getByRole('application', { name: 'Gráfico de orçamento, realizado e pendente por mês' });
    await planning.focus();
    await page.keyboard.press('ArrowRight');
    await expect(main.getByText(`Realizado: ${money(expenses)}`, { exact: true })).toBeVisible();
    await expect(main.getByText('Pendente: R$ 0,00', { exact: true })).toBeVisible();

    const distribution = main.getByRole('application', { name: 'Gráfico de distribuição de despesas por categoria' });
    await distribution.focus();
    await page.keyboard.press('ArrowRight');
    const tooltip = distribution.locator('..').locator('.recharts-tooltip-wrapper');
    await expect(tooltip.getByText(category, { exact: true })).toBeVisible();
    await expect(tooltip.getByText(money(expenses), { exact: true })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      main.getByRole('link', { name: 'Exportar CSV', exact: true }).click(),
    ]);
    const csv = await readFile((await download.path())!, 'utf8');
    const exportedBasis = basis === 'competence' ? 'competência' : 'caixa';
    expect(csv).toContain(`mensal;${month};${exportedBasis};income;${income}`);
    expect(csv).toContain(`mensal;${month};${exportedBasis};expenses;${expenses}`);
    expect(csv).toContain(`categoria;${month}..${month};${exportedBasis};${category};${expenses}`);
  }

  const summary = await page.request.get(`/api/months/${month}/summary`);
  expect(summary.status()).toBe(200);
  expect(await summary.json()).toMatchObject({ income, expenses });
  await page.goto('/?mes=' + month);
  const dashboard = page.getByRole('region', { name: 'Resumo financeiro do mês' });
  await expect(dashboard.getByText(money(income), { exact: true }).first()).toBeVisible();
  await expect(dashboard.getByText(money(expenses), { exact: true }).first()).toBeVisible();
}

test('reviewed import corrections affect every report only after confirmation and undo restores the baseline', async ({ page, context }, info) => {
  expect((await page.request.post('/api/auth/sign-in/email', {
    headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD },
  })).status()).toBe(200);
  const month = ({ chromium: '2022-02', webkit: '2022-04', 'mobile-web': '2022-06' })[info.project.name]!;
  const name = 'Métricas importadas ' + info.project.name + ' ' + randomUUID();
  const account = await create(page.request, '/api/accounts', { name, type: 'banco', openingBalance: '1000.00', openingDate: '2020-01-01' });
  const category = await create(page.request, '/api/categories', { name, color: '#336699' });
  const entry = { accountId: account.id, categoryId: category.id, description: name, status: 'settled', purchaseDate: month + '-01', competenceMonth: month + '-01', dueDate: null, paidDate: month + '-01' };
  await create(page.request, '/api/entries', { ...entry, kind: 'income', amount: '100.00' });
  await create(page.request, '/api/entries', { ...entry, kind: 'expense', amount: '0.30' });
  const reports = await context.newPage();
  await checkReports(reports, month, name, '100.00', '0.30');

  await page.goto('/imports');
  const main = page.getByRole('main'), filename = 'metrics-' + info.project.name + '.csv';
  await main.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true }).selectOption('account:' + account.id);
  await main.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles({
    name: filename, mimeType: 'text/csv',
    buffer: Buffer.from(`data;descricao;valor\n${month}-02;Compra;-10.25\n${month}-03;Receita;20.00\n${month}-04;Não selecionar;-777.00`),
  });
  await main.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
  const batch = page.getByRole('article', { name: 'Lote ' + filename, exact: true });
  await expect(batch).toContainText('Em revisão');
  for (const position of [1, 2]) {
    await batch.locator('summary').filter({ hasText: `Linha ${position} ·` }).click();
    await batch.getByLabel(`Categoria da linha ${position}`, { exact: true }).selectOption(category.id);
    await batch.getByLabel(`Selecionar linha ${position}`, { exact: true }).check();
    await batch.getByRole('button', { name: `Salvar linha ${position}`, exact: true }).click();
    await expect(batch.locator('summary').filter({ hasText: `Linha ${position} ·` })).toContainText('Selecionada');
  }
  const preview = batch.getByRole('region', { name: 'Prévia dos gráficos' });
  await expect(preview).toContainText('Despesas líquidas R$ 10,25');
  await checkReports(reports, month, name, '100.00', '0.30');

  await batch.locator('summary').filter({ hasText: 'Linha 1 ·' }).click();
  await batch.getByLabel('Valor da linha 1', { exact: true }).fill('-12,50');
  await expect(batch.getByRole('button', { name: 'Confirmar itens selecionados', exact: true })).toBeDisabled();
  await batch.getByRole('button', { name: 'Salvar linha 1', exact: true }).click();
  await expect(preview).toContainText('Receitas R$ 20,00 · Despesas líquidas R$ 12,50');
  await checkReports(reports, month, name, '100.00', '0.30');

  await batch.getByLabel('Revisei os itens selecionados, as duplicidades e o destino deste lote.', { exact: true }).check();
  await batch.getByRole('button', { name: 'Confirmar itens selecionados', exact: true }).click();
  await expect(batch).toContainText('Confirmado');
  await expect(preview).toHaveCount(0);
  await checkReports(reports, month, name, '120.00', '12.80');

  await page.reload();
  const history = page.getByRole('region', { name: 'Histórico de importações' });
  await history.locator('div').filter({ hasText: filename }).getByRole('button', { name: 'Abrir lote', exact: true }).click();
  await batch.getByRole('button', { name: 'Desfazer lote', exact: true }).click();
  await expect(batch).toContainText('Revertido');
  await checkReports(reports, month, name, '100.00', '0.30');
  await reports.close();
});
