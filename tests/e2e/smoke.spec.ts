import { test, expect, type Page } from '@playwright/test';
import { TEST_API_KEY } from './credentials';

async function authenticate(page: Page) {
 const response = await page.request.post('/api/session', { data: { credential: TEST_API_KEY } });
 expect(response.status()).toBe(200);
}


for (const path of ['/', '/accounts', '/transactions', '/settings', '/ai']) {
  test(`renders ${path} without unhandled browser errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await authenticate(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('main')).not.toHaveText('');
    expect(errors).toEqual([]);
  });
}

test('reads the synthetic database fixture, not a swallowed DB error', async ({ page }) => {
  await authenticate(page);
  await page.goto('/accounts');
  await expect(page.getByText('Backup sintético', { exact: true })).toBeVisible();
  await page.goto('/transactions');
  await expect(page.getByText('Compra sintética', { exact: true })).toBeVisible();
});

test('navigates between the existing account and settings screens', async ({ page }) => {
  await authenticate(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Contas', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.getByRole('link', { name: 'Opções', exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test('health is reachable and production seed is disabled', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok' });
  expect((await request.post('/api/seed')).status()).toBe(403);
});

for (const path of ['/api/transactions/notification', '/api/transactions/import-ofx', '/api/transactions/uber-webhook']) {
  test(`rejects absent and incorrect credentials for ${path}`, async ({ request }) => {
    const credentials: Record<string, string>[] = [{}, { 'x-api-secret-key': 'incorrect' }];
    for (const headers of credentials) {
      expect((await request.post(path, { headers, data: {} })).status()).toBe(401);
    }
  });
}

test('rejects invalid financial notification payload after authentication', async ({ request }) => {
  const response = await request.post('/api/transactions/notification', {
    headers: { 'x-api-secret-key': TEST_API_KEY },
    data: { description: '', amount: -1, bankName: '', latitude: 91, longitude: 181, timestamp: 'invalid' },
  });
  expect(response.status()).toBe(400);
});

 test('blocks anonymous financial pages and chat without exposing fixture data', async ({ page, request }) => {
  await page.goto('/accounts');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Backup sintético', { exact:true })).toHaveCount(0);
  expect((await request.post('/api/chat', { data: { message:'synthetic' } })).status()).toBe(401);
  expect((await request.get('/api/pluggy/token')).status()).toBe(401);
 });
 test('login rejects invalid credentials and cross-origin requests', async ({ request }) => {
  expect((await request.post('/api/session', { data:{ credential:'wrong' } })).status()).toBe(401);
  expect((await request.post('/api/session', { headers: { origin:'https://untrusted.invalid' }, data:{credential:TEST_API_KEY} })).status()).toBe(403);
 });
 test('session uses HttpOnly SameSite cookie and never returns the API credential', async ({ request }) => {
  const response = await request.post('/api/session', { data: { credential: TEST_API_KEY } });
  expect(response.status()).toBe(200);
  expect(response.headers()['set-cookie']).toContain('HttpOnly');
  expect(response.headers()['set-cookie']).toContain('SameSite=strict');
  expect(JSON.stringify(response.headers()) + await response.text()).not.toContain(TEST_API_KEY);
  expect((await request.post('/api/pluggy/sync', {headers:{origin:'https://untrusted.invalid'},data:{}})).status()).toBe(403);
 });
