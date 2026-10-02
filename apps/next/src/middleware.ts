import { NextRequest, NextResponse } from 'next/server';
import { matchesCredential, SESSION_COOKIE, validSession } from './lib/session';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (['/login', '/api/session', '/api/health', '/api/seed'].includes(path)) return NextResponse.next();
  const secret = process.env.API_SECRET_KEY;
  const session = validSession(request.cookies.get(SESSION_COOKIE)?.value, secret);
  const credential = matchesCredential(request.headers.get('x-api-secret-key'), secret);
  if (!session && !credential) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (path.startsWith('/api/') && session && !credential) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== request.nextUrl.origin) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }
    // Only the trusted server request receives the credential; it is never a response header.
    const headers = new Headers(request.headers);
    headers.set('x-api-secret-key', secret!);
    return NextResponse.next({ request: { headers } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
  runtime: 'nodejs',
};
