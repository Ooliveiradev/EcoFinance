import { afterEach, describe, expect, it, vi } from 'vitest';
const secure = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => secure.value, setItemAsync: async () => undefined,
  deleteItemAsync: async (key: string) => { if (key === 'ecofinance.session.v2') secure.value = null; }, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));
import { ApiError, apiRequest, toApiError } from './api';
import { SessionExpired } from '../services/backend-config';

const USER = '10000000-0000-4000-8000-000000000001';
const session = () => { secure.value = JSON.stringify({ url: 'https://api.example.test', credential: 'synthetic.signed', userId: USER }); };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); secure.value = null; });

describe('mobile API client', () => {
  it('sends Bearer, Idempotency-Key, quoted If-Match and an encoded query', async () => {
    session();
    const fetch = vi.fn().mockImplementation(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await apiRequest({ method: 'PATCH', path: '/api/entries/abc', body: { a: 1 }, key: 'k-1', ifMatch: 'rev-1', userId: USER });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/api/entries/abc');
    expect(init.headers.get('Authorization')).toBe('Bearer synthetic.signed');
    expect(init.headers.get('Idempotency-Key')).toBe('k-1');
    expect(init.headers.get('If-Match')).toBe('"rev-1"');
    expect(init.body).toBe('{"a":1}');
    await apiRequest({ path: '/api/reports', query: { from: '2026-10', to: '2026-10&x=1' } });
    expect(fetch.mock.calls[1]![0]).toBe('https://api.example.test/api/reports?from=2026-10&to=2026-10%26x%3D1');
  });

  it.each([
    [409, { error: 'REVISION_CONFLICT', message: 'O registro foi alterado. Recarregue antes de salvar.' }, 'conflict', 'REVISION_CONFLICT'],
    [400, { error: 'INVALID_INPUT', message: 'Confira os campos informados.' }, 'invalid', 'INVALID_INPUT'],
    [404, { error: 'NOT_FOUND' }, 'not-found', 'NOT_FOUND'],
    [403, { error: 'INVALID_ORIGIN' }, 'forbidden', 'INVALID_ORIGIN'],
    [503, { error: 'UNAVAILABLE', message: 'Não foi possível acessar seus dados. Tente novamente.' }, 'unavailable', 'UNAVAILABLE'],
    [502, 'not json', 'unavailable', null],
  ] as const)('classifies HTTP %i without inventing data', async (status, body, kind, code) => {
    session();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(typeof body === 'string' ? new Response(body, { status }) : json(body, status)));
    const error = await apiRequest({ path: '/api/accounts' }).then(() => null, (e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind, status, code });
    expect(error?.message.length).toBeGreaterThan(0);
  });

  it('treats network and timeout failures as offline and 401 as expired session', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    await expect(apiRequest({ path: '/api/accounts' })).rejects.toMatchObject({ kind: 'offline' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    await expect(apiRequest({ path: '/api/accounts' })).rejects.toMatchObject({ kind: 'offline' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'SESSION_EXPIRED' }, 401)));
    await expect(apiRequest({ path: '/api/accounts' })).rejects.toMatchObject({ kind: 'expired' });
    expect(secure.value).toBeNull();
  });

  it('rejects an unparsable success body and never swallows programming errors', async () => {
    session();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));
    await expect(apiRequest({ path: '/api/accounts' })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(apiRequest({ path: '/api/accounts?x=1' })).rejects.toThrow('Endpoint inválido.');
    expect(toApiError(new SessionExpired('x')).kind).toBe('expired');
    expect(() => toApiError(new RangeError('bug'))).toThrow('bug');
  });
});
