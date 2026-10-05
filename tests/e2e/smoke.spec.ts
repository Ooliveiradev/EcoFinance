import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
const database=e2eDatabase();
test.afterAll(async()=>{await database.end();});
test.beforeEach(async()=>{await database`DELETE FROM auth_rate_limits`;});
async function authenticate(request: APIRequestContext,email='a@example.test') {
  const response=await request.post('/api/auth/sign-in/email',{headers:{origin:'http://127.0.0.1:3000'},data:{email,password:TEST_PASSWORD}});
  expect(response.status()).toBe(200); return response;
}
for(const path of ['/','/accounts','/transactions','/settings','/ai']) {
  test(`renders ${path} with a user session and no browser errors`,async({page})=>{
    const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
    await authenticate(page.request); const response=await page.goto(path);
    expect(response?.status()).toBe(200); await expect(page.getByRole('main')).toBeVisible(); expect(errors).toEqual([]);
  });
}
test('login form uses a password and persists authenticated navigation',async({page})=>{
  await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email',{exact:true}).fill('a@example.test');
  await page.getByLabel('Senha',{exact:true}).fill(TEST_PASSWORD);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await page.goto('/accounts'); await expect(page.getByText('Backup sintético',{exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByText('Backup sintético',{exact:true})).toBeVisible();
});
test('two users never see each other in SSR, APIs or forged filters',async({page,browser})=>{
  await authenticate(page.request);
  await page.goto('/accounts'); await expect(page.getByText('Backup sintético',{exact:true})).toBeVisible();
  await expect(page.getByText('Conta B',{exact:true})).toHaveCount(0);
  const context=await browser.newContext(); const other:Page=await context.newPage();
  try {
    await authenticate(other.request,'b@example.test');
    await other.goto('/accounts'); await expect(other.getByText('Conta B',{exact:true})).toBeVisible();
    await expect(other.getByText('Backup sintético',{exact:true})).toHaveCount(0);
    await other.goto('/transactions'); await expect(other.getByText('Compra sintética',{exact:true})).toHaveCount(0);
    for(const query of ['', '?accountId=00000000-0000-4000-8000-000000000001','?id=00000000-0000-4000-8000-000000000002']) {
      const response=await other.request.get('/api/entries'+query); expect(response.status()).toBe(200); expect(await response.json()).toEqual({entries:[]});
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
  await database`UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id='10000000-0000-4000-8000-000000000001'`;
  expect((await page.request.get('/api/entries')).status()).toBe(401);
  await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email',{exact:true}).fill('a@example.test');
  await page.getByLabel('Senha',{exact:true}).fill(TEST_PASSWORD);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/');
  await page.goto('/accounts'); await expect(page.getByText('Backup sintético',{exact:true})).toBeVisible();
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
for(const path of ['/api/session','/api/seed','/api/pluggy/sync','/api/pluggy/webhook','/api/transactions/notification','/api/transactions/import-ofx','/api/transactions/uber-webhook']) {
  test(`retires ${path} and rejects the former global key`,async({request})=>{
    expect((await request.post(path,{headers:{'x-api-secret-key':'ci'.repeat(32)},data:{}})).status()).toBe(401);
    await authenticate(request);
    expect((await request.post(path,{headers:{origin:'http://127.0.0.1:3000'},data:{}})).status()).toBe(410);
  });
}
test('health exposes no private data and every other private API fails closed',async({request,page})=>{
  expect((await request.get('/api/health')).status()).toBe(200);
  for(const path of ['/api/accounts','/api/entries','/api/sessions','/api/pluggy/token','/api/transactions/nearby']) expect((await request.get(path)).status()).toBe(401);
  await page.goto('/accounts'); await expect(page).toHaveURL(/\/login$/); await expect(page.getByText('Backup sintético',{exact:true})).toHaveCount(0);
});
