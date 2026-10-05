import { describe, it, expect } from 'vitest';
import { authHeaders, trustedMutation, backendOrigin } from './access-policy';
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
