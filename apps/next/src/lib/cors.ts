import { backendOrigin, PRIVATE_CACHE } from './access-policy';

// CORS only tells browsers which other origins may read responses. It does not
// authenticate anyone and is no CSRF defence: native apps and scripts ignore
// it. Session checks (session.ts) and trustedMutation remain mandatory.
export const CORS_METHODS: readonly string[] = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
// Headers the web client actually sends (finance-client.ts). Authorization is
// absent on purpose: browsers use the HttpOnly cookie, Bearer is native-only.
export const CORS_REQUEST_HEADERS: readonly string[] = Object.freeze(['content-type', 'idempotency-key', 'if-match']);
export const CORS_MAX_AGE = 600;

export type CorsPolicy = { readonly origins: readonly string[] };
export type CorsDecision = { response: Response } | { headers: Headers };

// Every entry must be an exact HTTPS origin (HTTP only for localhost), so
// '*', 'null', patterns, paths and URL credentials never enter the allowlist.
export function corsPolicy(origins: readonly string[]): CorsPolicy {
  return Object.freeze({ origins: Object.freeze(origins.map(value => {
    const origin = backendOrigin(value);
    if (!/^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d+)?$/.test(origin)) throw new Error('Origem CORS deve ser exata.');
    return origin;
  })) });
}

function denied(): Response {
  return Response.json({ error: 'ORIGIN_NOT_ALLOWED' }, {
    status: 403, headers: { 'Cache-Control': PRIVATE_CACHE, Vary: 'Origin' },
  });
}

function tokens(value: string | null): string[] {
  return (value ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

// Requests without Origin are same-origin navigations or non-browser clients;
// they get no CORS headers and continue to authentication. An Origin outside
// the allowlist is refused before any session lookup. Allowed origins are
// echoed only after an exact match against the allowlist, never reflected.
export function evaluateCors(request: Request, policy: CorsPolicy, api: boolean): CorsDecision {
  const origin = request.headers.get('origin');
  if (origin === null) return { headers: new Headers() };
  if (!policy.origins.includes(origin)) return { response: denied() };
  const requested = request.headers.get('access-control-request-method');
  if (request.method === 'OPTIONS' && requested !== null) {
    if (!api || !CORS_METHODS.includes(requested) ||
        tokens(request.headers.get('access-control-request-headers')).some(name => !CORS_REQUEST_HEADERS.includes(name))) return { response: denied() };
    return { response: new Response(null, { status: 204, headers: {
      ...allowed(origin), 'Access-Control-Allow-Methods': CORS_METHODS.join(', '),
      'Access-Control-Allow-Headers': CORS_REQUEST_HEADERS.join(', '),
      'Access-Control-Max-Age': String(CORS_MAX_AGE), 'Cache-Control': PRIVATE_CACHE,
    } }) };
  }
  return { headers: new Headers(api ? allowed(origin) : {}) };
}

function allowed(origin: string): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
}
