import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); },
  removeItem: async (key: string) => { storage.delete(key); }, getAllKeys: async () => [...storage.keys()],
  multiRemove: async (keys: string[]) => { for (const key of keys) storage.delete(key); },
} }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => undefined, deleteItemAsync: async () => undefined }));
import { ApiError } from './api';
import { cacheName, loadWithCache } from './cache';
import { clearOtherUsers, clearUserData, readLocal, userKey, writeLocal } from './local-store';

const A = '10000000-0000-4000-8000-00000000000a', B = '10000000-0000-4000-8000-00000000000b';
const summary = { income: '100.00', expenses: '30.00' };
const at = () => new Date('2026-10-07T12:00:00Z');
beforeEach(() => storage.clear());

describe('private per-user cache', () => {
  it('stores the server copy under the user namespace and serves it, labelled, when offline', async () => {
    const fresh = await loadWithCache(A, 'report.2026-10', async () => summary, at);
    expect(fresh).toEqual({ data: summary, source: 'network', savedAt: '2026-10-07T12:00:00.000Z', error: null });
    expect([...storage.keys()]).toEqual([userKey(A, 'cache.report.2026-10')]);
    const stale = await loadWithCache(A, 'report.2026-10', async () => { throw new TypeError('Network request failed'); });
    expect(stale).toMatchObject({ data: summary, source: 'cache', savedAt: '2026-10-07T12:00:00.000Z' });
    expect(stale.error?.kind).toBe('offline');
  });

  it('surfaces the failure instead of zeros when there is no copy, and never shows another user\'s copy', async () => {
    await loadWithCache(A, 'report', async () => summary);
    await expect(loadWithCache(B, 'report', async () => { throw new TypeError('offline'); })).rejects.toMatchObject({ kind: 'offline' });
    await expect(loadWithCache(A, 'other', async () => { throw new ApiError('unavailable', 'Servidor indisponível.', 503); })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('does not hide conflicts, validation errors or expired sessions behind cached data', async () => {
    await loadWithCache(A, 'report', async () => summary);
    for (const kind of ['conflict', 'invalid', 'expired', 'not-found'] as const) {
      await expect(loadWithCache(A, 'report', async () => { throw new ApiError(kind, kind); })).rejects.toMatchObject({ kind });
    }
  });

  it('clears one user on logout and every other user on a new login', async () => {
    await writeLocal(A, 'cache.x', 1); await writeLocal(A, 'outbox', []); await writeLocal(B, 'cache.x', 2);
    storage.set('@ecofinance_onboarded', 'done');
    await clearOtherUsers(B);
    expect(await readLocal(A, 'cache.x')).toBeNull();
    expect(await readLocal(B, 'cache.x')).toBe(2);
    await clearUserData(B);
    expect([...storage.keys()]).toEqual(['@ecofinance_onboarded']);
  });

  it('rejects malformed user ids and key names, and drops corrupt entries', async () => {
    expect(() => userKey('../x', 'cache')).toThrow();
    expect(() => userKey(A, 'a/b')).toThrow();
    storage.set(userKey(A, 'cache.bad'), '{');
    expect(await readLocal(A, 'cache.bad')).toBeNull();
    expect(storage.has(userKey(A, 'cache.bad'))).toBe(false);
    expect(cacheName('invoice', 'card id', '2026-10')).toBe('invoice.card_id.2026-10');
  });
});
