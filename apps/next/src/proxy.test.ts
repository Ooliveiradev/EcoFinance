import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const requestSession = vi.hoisted(() => vi.fn());
vi.mock('./lib/session', () => ({ requestSession }));
vi.mock('./lib/auth', () => ({ appOrigin: () => 'https://finance.example.test' }));
const { proxy } = await import('./proxy');

const origin = 'https://finance.example.test';
function call(path: string, method: string, headers: Record<string, string> = {}) {
  return proxy(new NextRequest(origin + path, { method, headers }));
}

describe('proxy keeps CORS, authentication and CSRF as separate layers', () => {
  beforeEach(() => { requestSession.mockReset(); requestSession.mockResolvedValue({ user: { id: 'u1' } }); });

  it('denies a foreign origin before any session lookup, public routes included', async () => {
    for (const path of ['/api/entries', '/api/health', '/api/auth/sign-in/email', '/login', '/accounts']) {
      const response = await call(path, 'POST', { origin: 'https://hostile.test' });
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe('ORIGIN_NOT_ALLOWED');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(requestSession).not.toHaveBeenCalled();
  });
  it('answers preflight without credentials or a session', async () => {
    requestSession.mockResolvedValue(null);
    const allowed = await call('/api/entries', 'OPTIONS', { origin, 'access-control-request-method': 'DELETE' });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(origin);
    const denied = await call('/api/entries', 'OPTIONS', { origin: 'https://hostile.test', 'access-control-request-method': 'DELETE' });
    expect(denied.status).toBe(403);
    expect(requestSession).not.toHaveBeenCalled();
  });
  it('still requires a session and a trusted mutation after CORS allows the origin', async () => {
    requestSession.mockResolvedValue(null);
    const anonymous = await call('/api/entries', 'GET', { origin });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('access-control-allow-origin')).toBe(origin);
    requestSession.mockResolvedValue({ user: { id: 'u1' } });
    expect((await call('/api/entries', 'POST', { origin, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const csrf = await call('/api/entries', 'POST');
    expect(csrf.status).toBe(403);
    expect((await csrf.json()).error).toBe('INVALID_ORIGIN');
    const ok = await call('/api/entries', 'POST', { origin });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(origin);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
  });
  it('gives native Bearer clients without Origin no CORS headers and no CORS exemption from auth', async () => {
    const native = await call('/api/entries', 'DELETE', { authorization: 'Bearer signed.token' });
    expect(native.status).toBe(200);
    expect([...native.headers.keys()].some(name => name.startsWith('access-control-'))).toBe(false);
    requestSession.mockResolvedValue(null);
    expect((await call('/api/entries', 'GET', { authorization: 'Bearer revoked.token' })).status).toBe(401);
  });
  it('fails closed when the session store is unavailable', async () => {
    requestSession.mockRejectedValue(new Error('offline'));
    expect((await call('/api/entries', 'GET')).status).toBe(503);
  });
});
