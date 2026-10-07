import { test, expect, type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';

// Synthetic validation of the CORS policy (#38). The only allowed origin is
// AUTH_URL; every other browser origin is refused before authentication.
const database = e2eDatabase(), origin = 'http://127.0.0.1:3000', hostile = 'http://hostile.test';
test.beforeEach(async () => { await clearTestCollections(database, ['authRateLimits']); });
test.afterAll(async () => { await database.firestore.terminate(); });
async function login(request: APIRequestContext) {
  expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD } })).status()).toBe(200);
}
function corsHeaders(headers: Record<string, string>) {
  return Object.keys(headers).filter(name => name.startsWith('access-control-'));
}

test('preflight is answered only for the allowlisted origin, methods and headers', async ({ request }) => {
  const allowed = await request.fetch('/api/entries', { method: 'OPTIONS', headers: {
    origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type, idempotency-key, if-match',
  } });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()).toMatchObject({
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE', 'access-control-allow-headers': 'content-type, idempotency-key, if-match',
  });
  for (const path of ['/api/entries', '/api/auth/sign-in/email', '/api/health', '/accounts']) {
    for (const headers of [
      { origin: hostile, 'access-control-request-method': 'POST' },
      { origin: 'null', 'access-control-request-method': 'GET' },
      { origin: 'http://127.0.0.1:3000.hostile.test', 'access-control-request-method': 'GET' },
      { origin, 'access-control-request-method': 'TRACE' },
      { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' },
    ] as Record<string, string>[]) {
      const denied = await request.fetch(path, { method: 'OPTIONS', headers });
      expect(denied.status()).toBe(403);
      expect(corsHeaders(denied.headers())).toEqual([]);
    }
  }
});

test('a denied origin cannot read or change data even with a valid session cookie', async ({ request }) => {
  await login(request);
  expect((await request.get('/api/entries')).status()).toBe(200);
  const read = await request.get('/api/entries', { headers: { origin: hostile } });
  expect(read.status()).toBe(403); expect(await read.json()).toEqual({ error: 'ORIGIN_NOT_ALLOWED' });
  expect(corsHeaders(read.headers())).toEqual([]);
  for (const path of ['/api/accounts', '/api/health', '/api/auth/get-session']) {
    const response = await request.get(path, { headers: { origin: hostile } });
    expect(response.status()).toBe(403); expect(corsHeaders(response.headers())).toEqual([]);
  }
  const write = await request.post('/api/accounts', { headers: { origin: hostile }, data: { name: 'Hostil', type: 'carteira', openingBalance: '1.00', openingDate: '2000-01-01' } });
  expect(write.status()).toBe(403); expect((await write.json()).error).toBe('ORIGIN_NOT_ALLOWED');
  expect(JSON.stringify(await (await request.get('/api/accounts')).json())).not.toContain('Hostil');
  // The allowed origin gets the exact origin back, never a wildcard; CSRF still
  // runs separately when Origin is missing.
  const same = await request.get('/api/entries', { headers: { origin } });
  expect(same.status()).toBe(200);
  expect(same.headers()['access-control-allow-origin']).toBe(origin);
  expect(same.headers()['vary']).toContain('Origin');
  const missing = await request.post('/api/accounts', { data: {} });
  expect(missing.status()).toBe(403); expect((await missing.json()).error).toBe('INVALID_ORIGIN');
});

test('login responses never expose CORS headers or the device token to browsers', async ({ request }) => {
  const response = await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email: 'a@example.test', password: TEST_PASSWORD } });
  expect(response.status()).toBe(200);
  expect(response.headers()['access-control-expose-headers']).toBeUndefined();
  expect(response.headers()['set-auth-token']).toBeUndefined();
  expect(response.headers()['access-control-allow-origin']).toBe(origin);
});

test('a page on another origin cannot read the API from a real browser', async ({ page }) => {
  await login(page.request);
  await page.route(hostile + '/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>hostile</title>' }));
  await page.goto(hostile + '/');
  const results = await page.evaluate(async target => Promise.all(['/api/entries', '/api/health'].map(path =>
    fetch(target + path, { credentials: 'include' }).then(response => 'read ' + response.status, () => 'blocked'))), origin);
  expect(results).toEqual(['blocked', 'blocked']);
});
