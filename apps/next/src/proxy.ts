import { NextRequest, NextResponse } from 'next/server';
import { requestSession } from './lib/session';
import { trustedMutation, PRIVATE_CACHE } from './lib/access-policy';
import { appOrigin } from './lib/auth';
import { corsPolicy, evaluateCors } from './lib/cors';

export async function proxy(request: NextRequest) {
  const api = request.nextUrl.pathname.startsWith('/api/');
  let cors;
  try { cors = evaluateCors(request, corsPolicy([appOrigin()]), api); }
  catch { return unavailable(); }
  if ('response' in cors) return cors.response;
  const response = await gate(request, api);
  for (const [name, value] of cors.headers) response.headers.set(name, value);
  return response;
}

async function gate(request: NextRequest, api: boolean) {
  const path = request.nextUrl.pathname;
  if (path === '/api/health' || path === '/login' || path.startsWith('/api/auth/')) return NextResponse.next();
  try {
    const session = await requestSession(request);
    if (!session) {
      return api
        ? NextResponse.json({ error: 'SESSION_EXPIRED' }, { status: 401, headers: { 'Cache-Control': PRIVATE_CACHE } })
        : NextResponse.redirect(new URL('/login', request.url));
    }
    if (api && !trustedMutation(request, appOrigin())) {
      return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers: { 'Cache-Control': PRIVATE_CACHE } });
    }
    const response = NextResponse.next();
    response.headers.set('Cache-Control', PRIVATE_CACHE);
    return response;
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': PRIVATE_CACHE } });
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
