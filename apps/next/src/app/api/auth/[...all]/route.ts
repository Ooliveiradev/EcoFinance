import { createHash } from 'node:crypto';
import { db, sql } from '@ecofinance/db';
import { getAuth } from '../../../../lib/auth';
import { PRIVATE_CACHE } from '../../../../lib/access-policy';
import { readJson } from '../../../../lib/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reads = new Set(['/get-session']);
const writes = new Set(['/sign-in/email', '/sign-out', '/change-password', '/revoke-sessions', '/revoke-other-sessions']);

export async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname.slice('/api/auth'.length);
  const allowed = request.method === 'GET' ? reads : writes;
  if (!allowed.has(path)) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const origin = request.headers.get('origin');
  const trusted = new URL(getAuth().options.baseURL!).origin;
  const site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== trusted) || site === 'cross-site' || (request.method === 'POST' && !origin && site)) {
    return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  }
  if (request.method === 'POST' && origin === null && path !== '/sign-in/email' && !request.headers.has('authorization')) {
    return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  }
  let body: string | undefined;
  if (request.method === 'POST') {
    const parsed = await readJson(request, 16384);
    if (parsed instanceof Response) return parsed;
    if (path === '/change-password' && parsed && typeof parsed === 'object') {
      Object.assign(parsed, { revokeOtherSessions: true });
    }
    body = JSON.stringify(parsed);
  }
  // A shared bucket cannot be bypassed by spoofing forwarded IP headers.
  // Personal installations can add per-IP limits at a trusted ingress.
  if (path === '/sign-in/email') {
    const key = createHash('sha256').update('ecofinance-login-v1').digest('hex');
    const [bucket] = await db.execute<{ count: number }>(sql`
      INSERT INTO auth_rate_limits(key,count,last_request) VALUES(${key},1,(extract(epoch from now())*1000)::bigint)
      ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN auth_rate_limits.last_request < (extract(epoch from now())*1000)::bigint-60000 THEN 1 ELSE auth_rate_limits.count+1 END,
        last_request=CASE WHEN auth_rate_limits.last_request < (extract(epoch from now())*1000)::bigint-60000 THEN (extract(epoch from now())*1000)::bigint ELSE auth_rate_limits.last_request END
      RETURNING count
    `);
    if (bucket!.count > 5) return Response.json({ error: 'RATE_LIMITED' }, {
      status: 429, headers: { 'Retry-After': '60', 'Cache-Control': PRIVATE_CACHE },
    });
  }
  const headers = new Headers([...request.headers].filter(([key]) =>
    key !== 'content-length' && !(key === 'cookie' && request.headers.has('authorization'))));
  const response = await getAuth().handler(new Request(request.url, { method: request.method, headers, body }));
  const outputHeaders = new Headers([
    ...[...response.headers].filter(([key]) => key !== 'cache-control' && !(key === 'set-auth-token' && origin !== null)),
    ['Cache-Control', PRIVATE_CACHE],
  ]);
  const payload = await response.json();
  // A browser's HttpOnly session must never be mirrored in readable JSON.
  // Device clients obtain only the signed token via set-auth-token.
  if (payload && typeof payload === 'object') {
    delete payload.token;
    if (payload.session) delete payload.session.token;
  }
  return Response.json(payload, { status: response.status, headers: outputHeaders });
}
export async function GET(request: Request) {
  try { return await handleAuth(request); }
  catch { return Response.json({ error: 'SERVICE_UNAVAILABLE' }, {
    status: 503, headers: { 'Cache-Control': PRIVATE_CACHE },
  }); }
}
export const POST = GET;
