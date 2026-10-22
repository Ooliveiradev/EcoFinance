export const PRIVATE_CACHE = 'private, no-store';

// Cookie writes require an explicit trusted Origin. Bearer requests never fall
// back to cookies; malformed credentials cannot accidentally bypass CSRF.
export function trustedMutation(request: Request, origin: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const authorization = request.headers.get('authorization');
  if (authorization) return /^Bearer [A-Za-z0-9._~+/%-]+=*$/.test(authorization);
  return request.headers.get('origin') === origin && request.headers.get('sec-fetch-site') !== 'cross-site';
}

export function authHeaders(headers: Headers): Headers {
  const result = new Headers(headers);
  if (result.has('authorization')) result.delete('cookie');
  return result;
}

export function backendOrigin(value: string): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use HTTPS ou HTTP apenas em localhost/emulador.');
  return url.origin;
}
// Login and cookie writes only work on AUTH_URL (CORS, CSRF and host-only cookie). Platform
// aliases such as extra vercel.app domains would show a login that always fails, so pages
// opened there move to the canonical origin. APIs keep failing closed instead of redirecting.
// The Host header carries the name the browser asked for; request.url inside the Next proxy
// is rebuilt from the server's own bind address. A spoofed header can only cause a redirect
// to AUTH_URL itself.
export function canonicalRedirect(request: Request, origin: string): URL | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url), canonical = new URL(origin);
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host'))?.split(',')[0]?.trim().toLowerCase();
  if (url.pathname.startsWith('/api/') || !host || host === canonical.host) return null;
  return new URL(url.pathname + url.search, canonical);
}
