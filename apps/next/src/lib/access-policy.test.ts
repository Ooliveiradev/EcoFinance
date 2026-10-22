import { describe, it, expect } from 'vitest';
import { authHeaders, trustedMutation, backendOrigin, canonicalRedirect } from './access-policy';
describe('credential precedence and cookie CSRF', () => {
  const origin = 'https://finance.example.test';
  function request(method: string, headers: Record<string, string> = {}) { return new Request(origin, { method, headers }); }
  it('requires exact trusted origin on cookie mutations', () => {
    expect(trustedMutation(request('POST', { origin }), origin)).toBe(true);
    const cases: Record<string, string>[] = [{}, { origin: 'https://hostile.test' }, { origin: 'null' }, { origin, 'sec-fetch-site': 'cross-site' }];
    for (const headers of cases) expect(trustedMutation(request('POST', headers), origin)).toBe(false);
    expect(trustedMutation(request('GET'), origin)).toBe(true);
  });
  it('isolates bearer identity from an unrelated valid cookie', () => {
    expect(authHeaders(new Headers({ cookie: 'private', authorization: 'Basic invalid' })).has('cookie')).toBe(false);
    expect(authHeaders(new Headers({ cookie: 'private' })).get('cookie')).toBe('private');
    expect(trustedMutation(request('DELETE', { authorization: 'Bearer signed.token' }), origin)).toBe(true);
    expect(trustedMutation(request('POST', { authorization: 'invalid', origin }), origin)).toBe(false);
  });
  it('rejects remote cleartext and origins with credentials, paths or URL metadata', () => {
    expect(backendOrigin(origin)).toBe(origin); expect(backendOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    for (const url of ['http://finance.example.test', 'https://u:p@finance.example.test', origin + '/x', origin + '?x=1', origin + '#x', 'ftp://localhost']) expect(() => backendOrigin(url)).toThrow();
  });
});
describe('canonical origin for pages', () => {
  const origin = 'https://ecofinance.example.test';
  // Next rebuilds request.url from the bind address; only the Host header names the site.
  const page = (host: string, path: string, init: RequestInit = {}) => new Request('http://localhost:3000' + path, { ...init, headers: { host, ...(init.headers as Record<string, string> | undefined) } });
  it('moves pages opened on platform aliases to AUTH_URL, keeping path and query', () => {
    expect(canonicalRedirect(page('ecofinance-psi.vercel.app', '/planning?mes=2026-10'), origin)?.href).toBe(origin + '/planning?mes=2026-10');
    expect(canonicalRedirect(page('internal:8080', '/login', { headers: { 'x-forwarded-host': 'ecofinance-abc123-team.vercel.app' } }), origin)?.href).toBe(origin + '/login');
  });
  it('leaves the canonical host, APIs, unknown hosts and non-navigation methods alone', () => {
    expect(canonicalRedirect(page('ecofinance.example.test', '/login'), origin)).toBeNull();
    expect(canonicalRedirect(page('ECOFINANCE.example.test', '/'), origin)).toBeNull();
    expect(canonicalRedirect(new Request('http://localhost:3000/login'), 'http://localhost:3000')).toBeNull();
    expect(canonicalRedirect(page('ecofinance-psi.vercel.app', '/api/health'), origin)).toBeNull();
    expect(canonicalRedirect(page('ecofinance-psi.vercel.app', '/login', { method: 'POST' }), origin)).toBeNull();
  });
});
