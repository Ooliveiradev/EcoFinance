import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
const database=e2eDatabase();
test.afterAll(async()=>{await database.firestore.terminate();});
test.beforeEach(async()=>{await clearTestCollections(database,['authRateLimits']);});
async function authenticate(request: APIRequestContext,email='a@example.test') {
  const response=await request.post('/api/auth/sign-in/email',{headers:{origin:'http://127.0.0.1:3000'},data:{email,password:TEST_PASSWORD}});
  expect(response.status()).toBe(200); return response;
}
for(const path of ['/','/accounts','/transactions','/settings','/ai','/planning','/cards','/imports']) {
  test(`renders ${path} with a user session and no browser errors`,async({page})=>{
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await authenticate(page.request); const response=await page.goto(path);
    expect(response?.status()).toBe(200); await expect(page.getByRole('main')).toBeVisible(); expect(errors).toEqual([]);
  });
}
test('navigates through the desktop sidebar and the mobile drawer', async ({ page, isMobile }) => {
  await authenticate(page.request);
  await page.goto('/');
  for (const [name, path] of [['Contas e cartões', '/accounts'], ['Configurações', '/settings']] as const) {
    if (isMobile) await page.getByRole('button', { name: 'Abrir menu de navegação' }).click();
    await page.getByRole('link', { name, exact: true }).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(new RegExp(path + '$'));
    if (isMobile) await expect(page.getByRole('complementary', { name: 'Menu móvel' })).toHaveCount(0);
  }
});
test('expense dialog retains edits, traps keyboard focus and restores the trigger', async ({ page }) => {
  await authenticate(page.request);
  await page.goto('/');
  const trigger = page.getByRole('main').getByRole('button', { name: 'Adicionar gasto', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar Gasto', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Descrição do gasto *', { exact: true }).fill('Teste de foco');
  await dialog.getByLabel('Valor (R$) *', { exact: true }).fill('10,00');
  await dialog.getByLabel('Categoria', { exact: true }).selectOption({index:1});
  await expect(dialog.getByLabel('Descrição do gasto *', { exact: true })).toHaveValue('Teste de foco');
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab');
    // Browsers can move focus to browser chrome (reported as body) at the
    // document boundary, but the modal must never focus the inert background.
    expect(await dialog.evaluate(element => element.matches(':modal') &&
      (element.contains(document.activeElement) || document.activeElement === document.body))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByLabel('Descrição do gasto *', { exact: true })).toHaveValue('');
});
test('login form uses a password and persists authenticated navigation',async({page})=>{
  await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email',{exact:true}).fill('a@example.test');
  await page.getByLabel('Senha',{exact:true}).fill(TEST_PASSWORD);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await page.goto('/accounts'); await expect(page.getByRole('heading', { name: 'Backup sintético', exact: true }).filter({ visible: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Backup sintético', exact: true }).filter({ visible: true })).toBeVisible();
});
test('two users never see each other in SSR, APIs or forged filters',async({page,browser})=>{
  await authenticate(page.request);
  await page.goto('/accounts'); await expect(page.getByRole('heading', { name: 'Backup sintético', exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Conta B',{exact:true})).toHaveCount(0);
  const context=await browser.newContext(); const other:Page=await context.newPage();
  try {
    await authenticate(other.request,'b@example.test');
    await other.goto('/accounts'); await expect(other.getByRole('heading',{name:'Conta B',exact:true}).filter({visible:true})).toBeVisible();
    await expect(other.getByText('Backup sintético',{exact:true})).toHaveCount(0);
    await other.goto('/transactions'); await expect(other.getByText('Compra sintética',{exact:true})).toHaveCount(0);
    await other.goto('/?mes=2026-09');
    await expect(other.getByText('Compra sintética', { exact: true })).toHaveCount(0);
    await expect(other.getByText('Fatura Cartão A', { exact: true })).toHaveCount(0);
    await expect(other.getByText('Recorrente', { exact: true })).toHaveCount(0);
    await other.goto('/imports');
    await expect(other.locator('option', { hasText: 'Backup sintético' })).toHaveCount(0);
    await expect(other.getByText('confirmed', { exact: true })).toHaveCount(0);
    await other.goto('/planning?mes=2026-09');
    await expect(other.getByRole('main')).toBeVisible();
    await expect(other.getByText('Recorrente', { exact: true })).toHaveCount(0);
    for(const query of ['', '?accountId=00000000-0000-4000-8000-000000000001','?id=00000000-0000-4000-8000-000000000002']) {
      const response=await other.request.get('/api/entries'+query); expect(response.status()).toBe(200); expect((await response.json()).entries).toEqual([]);
    }
    expect((await other.request.get('/api/entries?ownerId=10000000-0000-4000-8000-000000000001')).status()).toBe(400);
    const response=await other.request.get('/api/accounts'); expect(JSON.stringify(await response.json())).not.toContain('Backup sintético');
    expect((await other.request.post('/api/chat',{headers:{origin:'http://127.0.0.1:3000'},data:{messages:[]}})).status()).toBe(503);
  } finally { await context.close(); }
});
test('SSR and APIs use Bearer identity consistently even when another cookie is present',async({request,playwright})=>{
  await authenticate(request);
  const native=await playwright.request.newContext();
  try {
    const login=await native.post('http://127.0.0.1:3000/api/auth/sign-in/email',{data:{email:'b@example.test',password:TEST_PASSWORD}});
    expect(login.status()).toBe(200);
    const headers={authorization:'Bearer '+login.headers()['set-auth-token']!};
    const page=await request.get('/accounts',{headers});
    expect(page.status()).toBe(200); const html=await page.text();
    expect(html).toContain('Conta B'); expect(html).not.toContain('Backup sintético');
    const data=await request.get('/api/accounts',{headers});
    expect(JSON.stringify(await data.json())).not.toContain('Backup sintético');
    expect((await request.get('/api/entries',{headers:{authorization:'Bearer incorrect'}})).status()).toBe(401);
  } finally { await native.dispose(); }
});
test('expired cookie returns to login and a new login resumes read access',async({page})=>{
  await authenticate(page.request);
  for(const session of await database.query('authSessions',{where:[{field:'userId',value:'10000000-0000-4000-8000-000000000001'}]})) await database.put('authSessions',{...session,expiresAt:new Date(Date.now()-1000)});
  expect((await page.request.get('/api/entries')).status()).toBe(401);
  await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email',{exact:true}).fill('a@example.test');
  await page.getByLabel('Senha',{exact:true}).fill(TEST_PASSWORD);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await page.goto('/accounts'); await expect(page.getByRole('heading', { name: 'Backup sintético', exact: true }).filter({ visible: true })).toBeVisible();
});
test('private data is never cached and login/session JSON exposes no session token or password',async({request})=>{
  const login=await authenticate(request);
  expect(login.headers()['set-cookie']).toContain('HttpOnly'); expect(login.headers()['set-cookie']!.toLowerCase()).toContain('samesite=strict');
  expect(login.headers()['set-auth-token']).toBeUndefined();
  const body=await login.json(); expect(body.token).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(TEST_PASSWORD);
  const current=await request.get('/api/auth/get-session');
  expect((await current.json()).session.token).toBeUndefined();
  const data=await request.get('/api/entries'); expect(data.headers()['cache-control']).toContain('no-store');
});
test('logout invalidates the saved cookie immediately and returns to login',async({page})=>{
  await authenticate(page.request); const cookies=await page.context().cookies();
  await page.goto('/settings'); await page.getByRole('button',{name:'Sair deste dispositivo',exact:true}).click();
  await expect(page).toHaveURL(/\/login$/); await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/);
  await page.context().addCookies(cookies);
  expect((await page.request.get('/api/entries')).status()).toBe(401);
});
test('CSRF rejects both hostile and absent origins for authenticated cookie mutations',async({request})=>{
  await authenticate(request);
  for(const headers of [{},{origin:'https://hostile.test'},{origin:'null'}] as Record<string,string>[]) {
    expect((await request.post('/api/auth/sign-out',{headers,data:{}})).status()).toBe(403);
    expect((await request.post('/api/chat',{headers,data:{}})).status()).toBe(403);
  }
});
test('device sessions can be revoked by ID only by their owner',async({request,playwright})=>{
  await authenticate(request);
  const native=await playwright.request.newContext();
  try {
    const response=await native.post('http://127.0.0.1:3000/api/auth/sign-in/email',{data:{email:'b@example.test',password:TEST_PASSWORD}});
    expect(response.status()).toBe(200);
    const token=response.headers()['set-auth-token']!;
    const list=await native.get('http://127.0.0.1:3000/api/sessions',{headers:{authorization:'Bearer '+token}});
    const id=(await list.json()).sessions[0].id;
    expect((await request.delete('/api/sessions',{headers:{origin:'http://127.0.0.1:3000'},data:{id}})).status()).toBe(404);
    expect((await native.delete('http://127.0.0.1:3000/api/sessions',{headers:{authorization:'Bearer '+token},data:{id}})).status()).toBe(200);
    expect((await native.get('http://127.0.0.1:3000/api/accounts',{headers:{authorization:'Bearer '+token}})).status()).toBe(401);
  } finally {await native.dispose();}
});
test('login limit is enforced and public signup is disabled',async({request})=>{
  for(let n=0;n<5;n++) expect((await request.post('/api/auth/sign-in/email',{data:{email:'missing@example.test',password:TEST_PASSWORD}})).status()).toBe(401);
  const limited=await request.post('/api/auth/sign-in/email',{data:{email:'missing@example.test',password:TEST_PASSWORD}});
  expect(limited.status()).toBe(429); expect(limited.headers()['retry-after']).toBe('60');
  expect((await request.post('/api/auth/sign-up/email',{data:{}})).status()).toBe(404);
});
// Legacy ingestion was removed in #15 (docs/refatoracao/transicao.md): no handler is left to write.
for(const path of ['/api/session','/api/seed','/api/pluggy/sync','/api/pluggy/token','/api/pluggy/webhook','/api/transactions/notification','/api/transactions/uber-webhook','/api/transactions/nearby','/api/transactions/import-ofx']) {
  test(`removed ${path} rejects the former global key and has no handler`,async({request})=>{
    expect((await request.post(path,{headers:{'x-api-secret-key':'ci'.repeat(32)},data:{}})).status()).toBe(401);
    await authenticate(request);
    expect((await request.post(path,{headers:{origin:'http://127.0.0.1:3000'},data:{}})).status()).toBe(404);
    expect((await request.get(path)).status()).toBe(404);
  });
}
test('main pages never ask for location or notification permission and the map is gone',async({page})=>{
  await page.addInitScript(()=>{
    const calls:string[]=[]; Object.defineProperty(window,'__permissionCalls',{value:calls});
    if(navigator.geolocation) for(const name of ['getCurrentPosition','watchPosition'] as const) navigator.geolocation[name]=(()=>{calls.push(name);return 0;}) as never;
    if('Notification' in window) Notification.requestPermission=(()=>{calls.push('notification');return Promise.resolve('denied');}) as never;
  });
  await authenticate(page.request);
  for(const path of ['/','/accounts','/transactions','/planning','/cards','/imports','/settings']) {
    await page.goto(path); await expect(page.getByRole('main')).toBeVisible();
  }
  await expect(page.getByText('Permissões do Dispositivo')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as unknown as {__permissionCalls:string[]}).__permissionCalls)).toEqual([]);
  expect((await page.goto('/map'))?.status()).toBe(404);
});
test('health exposes no private data and every other private API fails closed',async({request,page})=>{
  expect((await request.get('/api/health')).status()).toBe(200);
  for(const path of ['/api/accounts','/api/cards','/api/categories','/api/months/2026-10/summary','/api/entries','/api/sessions','/api/pluggy/token','/api/transactions/nearby']) expect((await request.get(path)).status()).toBe(401);
  await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/); await expect(page.getByText('Backup sintético',{exact:true})).toHaveCount(0);
  for (const path of ['/', '/planning', '/cards', '/imports', '/settings']) {
    await page.goto(path); await expect(page).toHaveURL(/\/login$/);
  }
});
