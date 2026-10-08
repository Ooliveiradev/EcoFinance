import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); },
  removeItem: async (key: string) => { storage.delete(key); }, getAllKeys: async () => [...storage.keys()],
  multiRemove: async (keys: string[]) => { for (const key of keys) storage.delete(key); },
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
const secure = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => secure.value, setItemAsync: async (_key: string, value: string) => { secure.value = value; },
  deleteItemAsync: async (key: string) => { if (key === 'ecofinance.session.v2') secure.value = null; }, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));
import { readLocal, writeLocal } from './local-store';
import { enqueue } from './outbox';
import { activeUserId, forgetDevice, logout, prepareUser, unsyncedCount } from './session';
import { onSessionExpired } from '../services/backend-config';

const A = '10000000-0000-4000-8000-00000000000a', B = '10000000-0000-4000-8000-00000000000b';
const login = (userId: string) => { secure.value = JSON.stringify({ url: 'https://api.example.test', credential: 'synthetic.signed', userId }); };
beforeEach(() => { storage.clear(); storage.set('@ecofinance_onboarded', 'done'); });
afterEach(() => { vi.unstubAllGlobals(); secure.value = null; });

describe('mobile session data lifecycle', () => {
  it('logout revokes on the server and then erases the cache and drafts of that user', async () => {
    login(A);
    await writeLocal(A, 'cache.report', { data: 1 });
    await enqueue(A, { method: 'POST', path: '/api/entries', body: {}, ifMatch: null, label: 'x', resource: null, kind: 'entry:create' });
    expect(await unsyncedCount(A)).toBe(1);
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await logout(false);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example.test/api/auth/sign-out');
    expect(secure.value).toBeNull();
    expect([...storage.keys()]).toEqual(['@ecofinance_onboarded']);
  });

  it('keeps local data when the server cannot be reached, so logout can be retried', async () => {
    login(A);
    await writeLocal(A, 'cache.report', { data: 1 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    await expect(logout(true)).rejects.toThrow();
    expect(await readLocal(A, 'cache.report')).toEqual({ data: 1 });
    expect(await activeUserId()).toBe(A);
  });

  it('offline exit erases credential, cache and drafts locally and notifies the app', async () => {
    login(A);
    await writeLocal(A, 'cache.report', { data: 1 });
    const listener = vi.fn(); const unsubscribe = onSessionExpired(listener);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await forgetDevice();
    expect(fetch).not.toHaveBeenCalled();
    expect(secure.value).toBeNull();
    expect(await readLocal(A, 'cache.report')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('a different account signing in never inherits the previous account\'s data', async () => {
    await writeLocal(A, 'cache.report', { data: 'A' });
    await writeLocal(B, 'cache.report', { data: 'B' });
    await prepareUser(B);
    expect(await readLocal(A, 'cache.report')).toBeNull();
    expect(await readLocal(B, 'cache.report')).toEqual({ data: 'B' });
  });
});
