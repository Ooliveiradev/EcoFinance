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
