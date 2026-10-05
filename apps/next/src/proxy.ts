import { NextRequest, NextResponse } from 'next/server';
import { requestSession } from './lib/session';
import { trustedMutation, PRIVATE_CACHE } from './lib/access-policy';
import { getAuth } from './lib/auth';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === '/api/health' || path === '/login' || path.startsWith('/api/auth/')) return NextResponse.next();
  const api = path.startsWith('/api/');
  try {
    const session = await requestSession(request);
    if (!session) {
      return api
        ? NextResponse.json({ error: 'SESSION_EXPIRED' }, { status: 401, headers: { 'Cache-Control': PRIVATE_CACHE } })
        : NextResponse.redirect(new URL('/login', request.url));
    }
    if (api && !trustedMutation(request, new URL(getAuth().options.baseURL!).origin)) {
      return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers: { 'Cache-Control': PRIVATE_CACHE } });
    }
    const response = NextResponse.next();
    response.headers.set('Cache-Control', PRIVATE_CACHE);
    return response;
  } catch {
    return NextResponse.json({ error: 'SERVICE_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': PRIVATE_CACHE } });
  }
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
