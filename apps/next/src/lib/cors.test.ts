import { describe, it, expect } from 'vitest';
import { corsPolicy, evaluateCors, CORS_METHODS, CORS_REQUEST_HEADERS } from './cors';

const origin = 'https://finance.example.test';
const policy = corsPolicy([origin]);
function request(method: string, headers: Record<string, string> = {}) {
  return new Request(origin + '/api/entries', { method, headers });
}
function preflight(from: string, method = 'POST', headers?: string) {
  return request('OPTIONS', { origin: from, 'access-control-request-method': method, ...(headers ? { 'access-control-request-headers': headers } : {}) });
}
function response(decision: ReturnType<typeof evaluateCors>) {
  if (!('response' in decision)) throw new Error('expected a response');
  return decision.response;
}

describe('explicit CORS allowlist', () => {
  it('accepts only exact HTTPS origins and can never hold a wildcard or opaque origin', () => {
    expect(policy.origins).toEqual([origin]);
    expect(Object.isFrozen(policy.origins)).toBe(true);
    expect(corsPolicy(['http://127.0.0.1:3000']).origins).toEqual(['http://127.0.0.1:3000']);
    expect(corsPolicy(['http://[::1]:3000']).origins).toEqual(['http://[::1]:3000']);
    for (const value of ['*', 'null', 'https://*.example.test', 'https://finance.*', 'http://finance.example.test', origin + '/api', origin + '?x=1', 'https://u:p@finance.example.test']) {
      expect(() => corsPolicy([value])).toThrow();
    }
  });
  it('keeps the method and header lists explicit and minimal', () => {
    expect(CORS_METHODS).toEqual(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(CORS_REQUEST_HEADERS).toEqual(['content-type', 'idempotency-key', 'if-match']);
    expect(CORS_REQUEST_HEADERS).not.toContain('authorization');
    expect(CORS_METHODS).not.toContain('*');
  });
});

describe('preflight', () => {
  it('answers an allowed preflight with the exact origin, never a wildcard', async () => {
    const result = response(evaluateCors(preflight(origin, 'PATCH', 'Content-Type, Idempotency-Key, If-Match'), policy, true));
    expect(result.status).toBe(204);
    expect(result.headers.get('access-control-allow-origin')).toBe(origin);
    expect(result.headers.get('access-control-allow-credentials')).toBe('true');
    expect(result.headers.get('access-control-allow-methods')).toBe('GET, HEAD, POST, PUT, PATCH, DELETE');
    expect(result.headers.get('access-control-allow-headers')).toBe('content-type, idempotency-key, if-match');
    expect(result.headers.get('access-control-max-age')).toBe('600');
    expect(result.headers.get('vary')).toBe('Origin');
    expect(await result.text()).toBe('');
  });
  it('denies preflight from a foreign, opaque or look-alike origin without CORS headers', () => {
    for (const from of ['https://hostile.test', 'null', 'https://finance.example.test.hostile.test', 'http://finance.example.test', 'https://FINANCE.example.test', origin + ':443', '*']) {
      const result = response(evaluateCors(preflight(from), policy, true));
      expect(result.status).toBe(403);
      expect(result.headers.get('access-control-allow-origin')).toBeNull();
      expect(result.headers.get('access-control-allow-credentials')).toBeNull();
      expect(result.headers.get('vary')).toBe('Origin');
    }
  });
  it('denies methods and headers outside the allowlist, including Authorization', () => {
    for (const [method, headers] of [['TRACE'], ['CONNECT'], ['patch'], ['POST', 'authorization'], ['POST', 'content-type, x-api-secret-key'], ['GET', 'cookie']]) {
      const result = response(evaluateCors(preflight(origin, method, headers), policy, true));
      expect(result.status).toBe(403);
      expect(result.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
  it('treats pages as non-CORS resources', () => {
    expect(response(evaluateCors(preflight(origin), policy, false)).status).toBe(403);
  });
});

describe('actual requests', () => {
  it('refuses any method from a denied origin before authentication runs', async () => {
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS']) {
      for (const page of [true, false]) {
        const result = response(evaluateCors(request(method, { origin: 'https://hostile.test' }), policy, page));
        expect(result.status).toBe(403);
        expect(result.headers.get('access-control-allow-origin')).toBeNull();
        if (method !== 'HEAD') expect((await result.json()).error).toBe('ORIGIN_NOT_ALLOWED');
      }
    }
  });
  it('adds exact-origin credentials headers for an allowed API origin only', () => {
    const decision = evaluateCors(request('POST', { origin }), policy, true);
    expect('headers' in decision && Object.fromEntries(decision.headers)).toEqual({
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin',
    });
    const page = evaluateCors(request('POST', { origin }), policy, false);
    expect('headers' in page && [...page.headers]).toEqual([]);
  });
  it('leaves requests without Origin to authentication and CSRF, adding no CORS headers', () => {
    for (const headers of [{}, { authorization: 'Bearer signed.token' }, { cookie: 'private' }] as Record<string, string>[]) {
      const decision = evaluateCors(request('POST', headers), policy, true);
      expect('headers' in decision && [...decision.headers]).toEqual([]);
    }
    const options = evaluateCors(request('OPTIONS', { origin }), policy, true);
    expect('headers' in options).toBe(true);
  });
  it('never emits a wildcard origin or credentials for an unlisted origin', () => {
    const origins = ['https://hostile.test', 'null', origin, 'https://other.example.test'];
    for (const from of origins) for (const method of ['GET', 'POST', 'OPTIONS']) for (const api of [true, false]) {
      for (const candidate of [request(method, { origin: from }), preflight(from, method)]) {
        const decision = evaluateCors(candidate, policy, api);
        const headers = 'response' in decision ? decision.response.headers : decision.headers;
        expect(headers.get('access-control-allow-origin')).not.toBe('*');
        if (headers.get('access-control-allow-credentials') !== null) expect(headers.get('access-control-allow-origin')).toBe(origin);
        if (from !== origin) expect(headers.get('access-control-allow-origin')).toBeNull();
      }
    }
  });
});
