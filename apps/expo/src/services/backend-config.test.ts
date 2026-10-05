import { afterEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: store.get, setItemAsync: store.set, deleteItemAsync: store.remove, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));
import { backendFetch, loadBackendConfig, saveBackendConfig, validateBackendConfig, signIn, signOut, onSessionExpired, SessionExpired } from './backend-config';
const config = { url: 'https://api.example.test', credential: 'synthetic.signed_token', userId: '10000000-0000-4000-8000-000000000001' };
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe('mobile device sessions', () => {
  it('allows HTTPS and local emulator only and rejects raw global credentials', () => {
    expect(validateBackendConfig(config)).toEqual(config);
    expect(validateBackendConfig({ ...config, url: 'http://10.0.2.2:3000' }).url).toContain('10.0.2.2');
    for (const url of ['http://api.example.test', 'https://user:password@api.example.test', 'https://api.example.test?credential=x', 'https://api.example.test/#x', 'ftp://api.example.test', 'https://api.example.test/x']) expect(() => validateBackendConfig({ ...config, url })).toThrow();
    expect(() => validateBackendConfig({ ...config, credential: 'global'.repeat(8) })).toThrow();
  });
  it('uses device-bound unlocked SecureStore and removes legacy configuration', async () => {
    await saveBackendConfig(config);
    expect(store.set).toHaveBeenCalledWith('ecofinance.session.v2', JSON.stringify(config), { keychainAccessible: 'device-only' });
    store.get.mockResolvedValue(null); expect(await loadBackendConfig()).toBeNull();
    expect(store.remove).toHaveBeenCalledWith('ecofinance.backend');
    store.get.mockResolvedValue('{bad'); expect(await loadBackendConfig()).toBeNull();
    expect(store.remove).toHaveBeenCalledWith('ecofinance.session.v2');
  });
  it('never follows redirects and fails before networking without a session or for an invalid endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch); store.get.mockResolvedValue(null);
    const listener = vi.fn(); const unsubscribe = onSessionExpired(listener);
    await expect(backendFetch('/api/accounts')).rejects.toBeInstanceOf(SessionExpired);
    expect(listener).toHaveBeenCalledTimes(1); unsubscribe();
    expect(fetch).not.toHaveBeenCalled(); store.get.mockResolvedValue(JSON.stringify(config));
    for (const path of ['https://hostile.test', '/api/../evil', '/api/accounts?redirect=evil', '/api/\\evil']) await expect(backendFetch(path)).rejects.toThrow();
    await backendFetch('/api/accounts'); const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(config.url + '/api/accounts'); expect(init.redirect).toBe('error'); expect(init.credentials).toBe('omit');
    expect(init.headers.get('Authorization')).toBe('Bearer ' + config.credential); expect(init.headers.has('x-api-secret-key')).toBe(false);
  });
  it('expires without replay, clears only its own credential and emits expiry', async () => {
    const listener = vi.fn(); const unsubscribe = onSessionExpired(listener);
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch); store.get.mockResolvedValue(JSON.stringify(config));
    await expect(backendFetch('/api/accounts')).rejects.toBeInstanceOf(SessionExpired);
    expect(fetch).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledTimes(1);
    expect(store.remove).toHaveBeenCalledWith('ecofinance.session.v2'); unsubscribe();
  });
  it('does not erase a new login when an older request expires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    store.get.mockResolvedValueOnce(JSON.stringify(config)).mockResolvedValueOnce(JSON.stringify({ ...config, credential: 'new.signed' }));
    await expect(backendFetch('/api/accounts')).rejects.toBeInstanceOf(SessionExpired);
    expect(store.remove).not.toHaveBeenCalledWith('ecofinance.session.v2');
  });
  it('stores signed login token rather than password and refuses malformed login responses', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { id: config.userId } }), { headers: { 'set-auth-token': config.credential } }));
    vi.stubGlobal('fetch', fetch); await signIn(config.url, 'Person@Example.test', 'synthetic password');
    expect(store.set.mock.calls[0]![1]).not.toContain('password');
    expect(JSON.parse(fetch.mock.calls[0]![1].body).email).toBe('person@example.test');
    fetch.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(signIn(config.url, 'x@y.test', 'synthetic')).rejects.toThrow('Muitas');
    fetch.mockResolvedValue(new Response('{}'));
    await expect(signIn(config.url, 'x@y.test', 'synthetic')).rejects.toThrow('sessão');
    await expect(signIn('http://hostile.test', 'x@y.test', 'synthetic')).rejects.toThrow();
  });
  it('does not claim revocation on network failure and allows retry', async () => {
    store.get.mockResolvedValue(JSON.stringify(config)); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(signOut()).rejects.toThrow('offline'); expect(store.remove).not.toHaveBeenCalledWith('ecofinance.session.v2');
  });
  it.each([401, 200])('serializes new login against pending credential deletion (%i)', async status => {
    let stored: string | null = JSON.stringify(config);
    const next = { ...config, credential: 'new.signed' };
    let entered!: () => void; let release!: () => void;
    const deleting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.get.mockImplementation(async () => stored);
    store.set.mockImplementation(async (_key: string, value: string) => { stored = value; });
    store.remove.mockImplementation(async (key: string) => {
      if (key !== 'ecofinance.session.v2') return;
      entered(); await gate; stored = null;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    const pending = status === 401 ? backendFetch('/api/accounts').catch(error => error) : signOut();
    await deleting;
    const saving = saveBackendConfig(next);
    expect(store.set).not.toHaveBeenCalled();
    release(); await saving;
    if (status === 401) expect(await pending).toBeInstanceOf(SessionExpired);
    else await pending;
    expect(await loadBackendConfig()).toEqual(next);
  });
  it('an old successful logout cannot clear a login completed while its response was pending', async () => {
    let stored: string | null = JSON.stringify(config);
    let respond!: (value: Response) => void; let started!: () => void;
    const response = new Promise<Response>(resolve => { respond = resolve; });
    const request = new Promise<void>(resolve => { started = resolve; });
    store.get.mockImplementation(async () => stored);
    store.set.mockImplementation(async (_key: string, value: string) => { stored = value; });
    store.remove.mockImplementation(async (key: string) => { if (key === 'ecofinance.session.v2') stored = null; });
    const fetch = vi.fn().mockImplementation(() => { started(); return response; });
    vi.stubGlobal('fetch', fetch);
    const pending = signOut(); await request;
    const next = { ...config, credential: 'new.signed' };
    await saveBackendConfig(next); respond(new Response('{}'));
    await pending;
    expect(await loadBackendConfig()).toEqual(next);
    expect(fetch.mock.calls[0]![1].headers.get('Authorization')).toBe('Bearer '+config.credential);
  });
});
