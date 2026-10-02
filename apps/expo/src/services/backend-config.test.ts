import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: store.get, setItemAsync: store.set, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
}));
import { backendFetch, loadBackendConfig, saveBackendConfig, validateBackendConfig } from './backend-config';

const credential = 'synthetic'.repeat(8);
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
describe('mobile credential storage and transport', () => {
  it('uses HTTPS remotely and allows cleartext only on explicit loopback/emulator hosts', () => {
    expect(validateBackendConfig({ url: 'https://api.example.test', credential }).url).toBe('https://api.example.test');
    expect(validateBackendConfig({ url: 'http://10.0.2.2:3000', credential }).url).toBe('http://10.0.2.2:3000');
    for (const url of ['http://api.example.test', 'https://user:password@api.example.test', 'https://api.example.test?credential=x', 'https://api.example.test/#x', 'ftp://api.example.test']) {
      expect(() => validateBackendConfig({ url, credential })).toThrow();
    }
    expect(() => validateBackendConfig({ url: 'https://api.example.test', credential: 'short' })).toThrow();
  });
  it('stores credentials only in device-bound SecureStore and reads configuration at runtime', async () => {
    await saveBackendConfig({ url: 'https://api.example.test/', credential });
    expect(store.set).toHaveBeenCalledWith('ecofinance.backend', JSON.stringify({ url: 'https://api.example.test', credential }), { keychainAccessible: 'device-only' });
    store.get.mockResolvedValue(null);
    expect(await loadBackendConfig()).toBeNull();
    store.get.mockResolvedValue(JSON.stringify({ url: 'https://api.example.test', credential }));
    expect(await loadBackendConfig()).toEqual({ url: 'https://api.example.test', credential });
  });
  it('fails before networking without configuration, blocks invalid endpoints and prevents credential redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    store.get.mockResolvedValue(null);
    await expect(backendFetch('/api/pluggy/token')).rejects.toThrow('Configure');
    expect(fetch).not.toHaveBeenCalled();
    store.get.mockResolvedValue(JSON.stringify({ url: 'https://api.example.test', credential }));
    await expect(backendFetch('https://untrusted.invalid')).rejects.toThrow('Endpoint');
    await backendFetch('/api/pluggy/token');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/api/pluggy/token');
    expect(init.redirect).toBe('error');
    expect(init.headers.get('x-api-secret-key')).toBe(credential);
  });
});
