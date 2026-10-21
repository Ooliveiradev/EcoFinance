// Capturas reais do README (#17), com a web local e o mês de scripts/demo/seed-demo.ts.
//   pnpm exec tsx scripts/demo/capture.ts   # grava docs/screenshots/*.png
import { chromium, devices, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000';
const month = process.env.DEMO_MONTH ?? '2026-10';
const out = 'docs/screenshots';
const pages = [
  ['mes', `/?mes=${month}`], ['lancamentos', `/transactions?mes=${month}`], ['planejamento', `/planning?mes=${month}`],
  ['cartoes', `/cards?mes=${month}`], ['relatorios', `/reports?de=${month}&ate=${month}`], ['importacoes', '/imports'],
] as const;

// A synthetic statement left in review: the batch never changes balances until confirmed.
async function uploadForReview(page: Page) {
  const main = page.getByRole('main');
  const destination = main.getByRole('combobox', { name: 'Conta ou cartão de destino', exact: true });
  const value = await destination.locator('option', { hasText: 'Conta corrente' }).first().getAttribute('value');
  await destination.selectOption(value!);
  await main.getByLabel('Arquivos para revisão', { exact: true }).setInputFiles({
    name: 'extrato-exemplo.csv', mimeType: 'text/csv',
    buffer: Buffer.from(`data;descricao;valor\n${month}-19;Mercado Exemplo;-132.45\n${month}-20;Posto Exemplo;-180.00\n${month}-20;Pix recebido;250.00\n`),
  });
  await page.getByRole('button', { name: 'Carregar e analisar', exact: true }).click();
  await page.getByRole('article', { name: 'Lote extrato-exemplo.csv', exact: true }).getByText('Em revisão').first().waitFor();
}

async function shoot(browser: Browser, suffix: string, options: Parameters<Browser['newContext']>[0], only?: string[], fullPage = true) {
  const context = await browser.newContext({ ...options, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(base + '/login');
  await page.getByLabel('Email').fill('demo@example.test');
  await page.getByLabel('Senha').fill('demo-synthetic-password');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
  for (const [name, path] of pages) {
    if (only && !only.includes(name)) continue;
    await page.goto(base + path);
    await page.waitForLoadState('networkidle');
    if (name === 'importacoes' && await page.getByText('Nenhum arquivo recebido.').count()) await uploadForReview(page);
    await page.waitForTimeout(2000); // charts finish their entry animation
    await page.screenshot({ path: `${out}/${name}${suffix}.png`, fullPage });
  }
  await context.close();
}

async function main() {
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch();
  try {
    await shoot(browser, '', { viewport: { width: 1440, height: 900 } });
    // Viewport only: the fixed bottom navigation would land mid-page in a full-page capture.
    await shoot(browser, '-mobile', { ...devices['Pixel 7'] }, ['mes', 'planejamento'], false);
  } finally { await browser.close(); }
  console.log(`Capturas em ${out}/ (${base}, mês ${month}).`);
}
main().catch(error => { console.error(error); process.exit(1); });
