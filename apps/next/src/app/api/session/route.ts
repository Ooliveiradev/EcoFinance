import { NextRequest, NextResponse } from 'next/server';
import { createSession, matchesCredential, SESSION_COOKIE, SESSION_SECONDS } from '@/lib/session';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  const credential = body && typeof body === 'object' && 'credential' in body && typeof body.credential === 'string' ? body.credential : null;
  const secret = process.env.API_SECRET_KEY;
  if (!matchesCredential(credential, secret)) return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 });
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(SESSION_COOKIE, createSession(secret!), {
    httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
