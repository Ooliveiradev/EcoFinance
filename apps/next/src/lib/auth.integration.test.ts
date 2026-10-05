import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrate, readMigrations } from '../../../../packages/db/src/migrations';

const adminUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl) throw new Error('TEST_DATABASE_URL is required');
const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
const databaseName = 'ecofinance_auth_' + randomBytes(8).toString('hex');
const origin = 'http://127.0.0.1:3000';
const ownerA = '10000000-0000-4000-8000-000000000001';
const ownerB = '20000000-0000-4000-8000-000000000001';
const password = 'ef03-synthetic-password';
let connection: Sql;
let gateway: typeof import('../app/api/auth/[...all]/route');
let sessions: typeof import('./session');
let provision: typeof import('./provision-user');
let queries: typeof import('./owned-queries');
let data: typeof import('@ecofinance/db');

beforeAll(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(adminUrl); url.pathname = '/' + databaseName;
  connection = postgres(url.toString(), { max: 1, prepare: false, onnotice: () => {} });
  await migrate(connection, await readMigrations(fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url))));
  await connection.unsafe(await readFile(new URL('../../../../packages/db/tests/fixtures/recovery.sql', import.meta.url), 'utf8'));
  vi.stubEnv('DATABASE_URL', url.toString());
  vi.stubEnv('AUTH_URL', origin);
  vi.stubEnv('AUTH_SECRET', 'synthetic-auth-secret'.repeat(4));
  data = await import('@ecofinance/db');
  provision = await import('./provision-user');
  gateway = await import('../app/api/auth/[...all]/route');
  sessions = await import('./session');
  queries = await import('./owned-queries');
  await provision.provisionUser(data.db, { email: 'a@example.test', password, ownerId: ownerA });
  await provision.provisionUser(data.db, { email: 'b@example.test', password, ownerId: ownerB });
});
beforeEach(async () => {
  await connection`DELETE FROM auth_sessions`;
  await connection`DELETE FROM auth_rate_limits`;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await data?.closeDatabase();
  await connection?.end();
  await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
  await admin.end();
});
function authRequest(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(origin + '/api/auth' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(email = 'a@example.test', web = false) {
  const response = await gateway.POST(authRequest('/sign-in/email', { email, password }, web ? { origin } : {}));
  expect(response.status).toBe(200);
  return response;
}
describe('real PostgreSQL authentication and ownership', () => {
  it('maps existing financial owner without changing balances or history', async () => {
    const response = await login();
    const body = await response.json();
    expect(body.user.id).toBe(ownerA);
    expect(body.token).toBeUndefined();
    const [stored]=await connection`SELECT password FROM auth_accounts WHERE user_id=${ownerA}`;
    expect(stored!.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored!.password).not.toContain(password);
    expect(await connection`SELECT amount::text FROM transactions ORDER BY id`).toEqual([{amount:'-42.90'},{amount:'10.00'}]);
    expect(await connection`SELECT count(*)::int AS count FROM auth_accounts`).toEqual([{count:2}]);
    await expect(provision.provisionUser(data.db, {email:'new@example.test',password,ownerId:ownerA})).rejects.toThrow('associado');
    expect(await connection`SELECT count(*)::int AS count FROM auth_accounts`).toEqual([{count:2}]);
  });
  it('creates distinct signed per-device tokens and rejects unsigned or tampered tokens', async () => {
    const first = await login(); const second = await login();
    const one = first.headers.get('set-auth-token')!;
    expect(one).toBeTruthy(); expect(one).not.toBe(second.headers.get('set-auth-token'));
    const request = new Request(origin + '/api/accounts', { headers: { authorization: 'Bearer ' + one } });
    expect((await sessions.requestSession(request))?.user.id).toBe(ownerA);
    for (const token of [one + 'x', one.split('.')[0], 'global-secret']) {
      expect(await sessions.requestSession(new Request(origin, { headers: { authorization: 'Bearer ' + token } }))).toBeNull();
    }
  });
  it('isolates cookies, enforces CSRF and does not fall back to cookies for bad Authorization', async () => {
    const response = await login('a@example.test', true);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')!.toLowerCase()).toContain('samesite=strict');
    expect(response.headers.has('set-auth-token')).toBe(false);
    expect((await gateway.GET(authRequest('/get-session',undefined,{cookie,'sec-fetch-site':'same-origin'}))).status).toBe(200);
    expect((await sessions.requestSession(new Request(origin, {headers:{cookie}})))?.user.id).toBe(ownerA);
    expect(await sessions.requestSession(new Request(origin, {headers:{cookie,authorization:'Bearer incorrect'}}))).toBeNull();
    const denied = await sessions.authorize(new Request(origin, {method:'POST',headers:{cookie}}));
    expect(denied.response?.status).toBe(403);
    expect((await sessions.authorize(new Request(origin,{method:'POST',headers:{cookie,origin}}))).userId).toBe(ownerA);
    expect((await gateway.POST(authRequest('/sign-out',{}, {cookie,origin:'https://hostile.test'}))).status).toBe(403);
  });
  it('never returns another owner from account, ID, description or model-like filters', async () => {
    expect(await queries.ownedEntries(data.db, ownerB, {})).toEqual([]);
    expect(await queries.ownedEntries(data.db, ownerB, {id:'00000000-0000-4000-8000-000000000002'})).toEqual([]);
    expect(await queries.ownedEntries(data.db, ownerB, {accountId:'00000000-0000-4000-8000-000000000001'})).toEqual([]);
    expect(await queries.ownedEntries(data.db, ownerB, {description:'Compra'})).toEqual([]);
    const result = await queries.ownedEntries(data.db, ownerA, {});
    expect(result).toHaveLength(2); expect(result[0]!.amount).toBe('10.00');
    await expect(queries.ownedEntries(data.db, ownerB, {ownerId:ownerA} as never)).rejects.toThrow();
  });
  it('checks revocation on every request and only signs out the current device', async () => {
    const first = (await login()).headers.get('set-auth-token')!;
    const second = (await login()).headers.get('set-auth-token')!;
    expect((await gateway.POST(authRequest('/sign-out',{}, {authorization:'Bearer '+first}))).status).toBe(200);
    expect(await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+first}}))).toBeNull();
    expect((await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+second}})))?.user.id).toBe(ownerA);
  });
  it('rejects expired sessions, global credentials and anonymous retired uploads before reading the body', async () => {
    const token = (await login()).headers.get('set-auth-token')!;
    await connection`UPDATE auth_sessions SET expires_at=now()-interval '1 second'`;
    expect(await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+token}}))).toBeNull();
    expect((await sessions.retiredEndpoint(new Request(origin,{headers:{'x-api-secret-key':'synthetic'}}))).status).toBe(401);
    expect((await sessions.retiredEndpoint(new Request(origin))).status).toBe(401);
    const active = (await login()).headers.get('set-auth-token')!;
    expect((await sessions.retiredEndpoint(new Request(origin,{method:'POST',headers:{authorization:'Bearer '+active},body:'unparsed upload'}))).status).toBe(410);
  });
  it('disables public signup and bounds actual auth body bytes including chunked requests', async () => {
    expect((await gateway.POST(authRequest('/sign-up/email',{email:'evil@example.test',password,name:'evil'}))).status).toBe(404);
    const huge = authRequest('/sign-in/email',{email:'a@example.test',password:'x'.repeat(17000)});
    expect((await gateway.POST(huge)).status).toBe(413);
    expect((await gateway.POST(authRequest('/sign-in/email',{email:'a@example.test',password:'wrong'}))).status).toBe(401);
  });
  it('throttles concurrent login attempts in PostgreSQL even with spoofed forwarded addresses', async () => {
    const attempts = await Promise.all(Array.from({length:8},(_,n) => gateway.POST(authRequest('/sign-in/email',{email:'missing@example.test',password},{'x-forwarded-for':'192.0.2.'+n}))));
    expect(attempts.filter(r=>r.status===429)).toHaveLength(3);
    const [bucket] = await connection`SELECT count FROM auth_rate_limits WHERE length(key)=64`;
    expect(bucket!.count).toBe(8);
  });
  it('enforces absolute six-hour expiry without renewing an active session', async () => {
    const token = (await login()).headers.get('set-auth-token')!;
    const [created] = await connection`SELECT extract(epoch FROM expires_at-created_at)::int AS lifetime FROM auth_sessions`;
    expect(created!.lifetime).toBe(21600);
    await connection`UPDATE auth_sessions SET updated_at=now()-interval '2 days',expires_at=now()+interval '10 minutes'`;
    const [before] = await connection`SELECT expires_at FROM auth_sessions`;
    expect(await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+token}}))).not.toBeNull();
    const [after] = await connection`SELECT expires_at FROM auth_sessions`;
    expect(after!.expires_at).toEqual(before!.expires_at);
  });
  it('forces revocation after password change even when the caller opts out', async () => {
    const one=(await login('b@example.test')).headers.get('set-auth-token')!;
    const two=(await login('b@example.test')).headers.get('set-auth-token')!;
    const response=await gateway.POST(authRequest('/change-password',{currentPassword:password,newPassword:'changed-synthetic-password',revokeOtherSessions:false},{authorization:'Bearer '+one}));
    expect(response.status).toBe(200);
    for(const token of [one,two]) expect(await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+token}}))).toBeNull();
    await provision.provisionUser(data.db,{email:'b@example.test',password,reset:true});
  });
  it('sets Secure cookies for the canonical HTTPS deployment', async () => {
    const {createAuth}=await import('./auth');
    const secure=createAuth(data.db,'https://finance.example.test','synthetic-https-secret'.repeat(4));
    const response=await secure.handler(new Request('https://finance.example.test/api/auth/sign-in/email',{
      method:'POST',headers:{'content-type':'application/json',origin:'https://finance.example.test'},body:JSON.stringify({email:'a@example.test',password}),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });
  it('recovers access atomically and revokes every device while preserving the owner', async () => {
    // Recovery below uses user A; this also proves user B remains unaffected.
    const token = (await login()).headers.get('set-auth-token')!;
    const other = (await login('b@example.test')).headers.get('set-auth-token')!;
    await provision.provisionUser(data.db,{email:'a@example.test',password:'replacement-synthetic-password',reset:true});
    expect(await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+token}}))).toBeNull();
    expect((await sessions.requestSession(new Request(origin,{headers:{authorization:'Bearer '+other}})))?.user.id).toBe(ownerB);
    const response=await gateway.POST(authRequest('/sign-in/email',{email:'a@example.test',password:'replacement-synthetic-password'}));
    expect(response.status).toBe(200); expect((await response.json()).user.id).toBe(ownerA);
    expect((await gateway.POST(authRequest('/sign-in/email',{email:'a@example.test',password}))).status).toBe(401);
  });
});
