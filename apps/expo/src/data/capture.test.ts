import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null, setItem: async (key: string, value: string) => { storage.set(key, value); },
  removeItem: async (key: string) => { storage.delete(key); }, getAllKeys: async () => [...storage.keys()],
  multiRemove: async (keys: string[]) => { for (const key of keys) storage.delete(key); },
} }));
vi.mock('expo-crypto', () => ({
  randomUUID: () => crypto.randomUUID(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  // Deterministic stand-in for SHA-256: the test needs a stable key per set of notices.
  digestStringAsync: async (_algorithm: string, data: string) => [...data].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7).toString(16).padStart(32, '0'),
}));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {}, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' }));
import { ApiError, type ApiRequest } from './api';
import { CAPTURE_SYNC, backoff, batchKey, captureSyncState, saveCaptureSources, syncCaptures } from './capture';
import type { CaptureNative, CapturedNotice } from '../../modules/ecofinance-capture';

/** Optional capture (#19): queue → idempotent upload, backoff, and no crossing between accounts. */
const A = '10000000-0000-4000-8000-00000000000a', B = '10000000-0000-4000-8000-00000000000b';
function fakeNative(owner: string | null, count: number) {
  const queue: CapturedNotice[] = Array.from({ length: count }, (_, i) => ({ id: `com.exemplo.banco|k${i}|${1000 + i}`, package: 'com.exemplo.banco', key: `k${i}`, postedAt: '2026-10-29T18:30:00.000Z', title: 'Banco', text: `Compra de R$ ${i + 1},00 aprovada em LOJA ${i}` }));
  const configured: [string | null, string[]][] = [];
  const native: CaptureNative = {
    isAccessGranted: () => true, openAccessSettings: () => {}, clear: () => { queue.length = 0; },
    configure: (who, packages) => { configured.push([who, packages]); owner = who; },
    peek: limit => queue.slice(0, limit), remove: ids => { for (const id of ids) queue.splice(queue.findIndex(item => item.id === id), 1); },
    status: () => ({ owner, packages: ['com.exemplo.banco'], queued: queue.length, dropped: 0, lastEventAt: null, connected: true }),
  };
  return { native, queue, configured };
}
const ok = (calls: ApiRequest[]) => async (request: ApiRequest) => { calls.push(request); return { accepted: (request.body as { events: unknown[] }).events.length, repeated: 0, ignored: { 'aviso não financeiro': 0 } }; };
beforeEach(() => storage.clear());

describe('capture sync', () => {
  it('does nothing without the native module or for another account', async () => {
    const calls: ApiRequest[] = [];
    expect(await syncCaptures(null, A, ok(calls))).toMatchObject({ skipped: 'unavailable' });
    const { native, queue } = fakeNative(A, 2);
    expect(await syncCaptures(native, B, ok(calls))).toMatchObject({ skipped: 'unavailable' });
    expect(calls).toHaveLength(0); expect(queue).toHaveLength(2);
  });
  it('sends the oldest notices in batches with a stable device and an idempotency key per batch', async () => {
    const { native, queue } = fakeNative(A, CAPTURE_SYNC.batch + 3), calls: ApiRequest[] = [];
    const first = await syncCaptures(native, A, ok(calls));
    expect(first).toMatchObject({ sent: 50, accepted: 50 });
    expect(queue).toHaveLength(3);
    await syncCaptures(native, A, ok(calls));
    expect(queue).toHaveLength(0);
    expect(await syncCaptures(native, A, ok(calls))).toMatchObject({ skipped: 'empty' });
    const [one, two] = calls as [ApiRequest, ApiRequest];
    expect(one).toMatchObject({ method: 'POST', path: '/api/captures/events', userId: A });
    expect((one.body as { deviceId: string }).deviceId).toBe((two.body as { deviceId: string }).deviceId);
    expect((one.body as { events: Record<string, unknown>[] }).events[0]).toEqual({ package: 'com.exemplo.banco', key: 'k0', postedAt: '2026-10-29T18:30:00.000Z', title: 'Banco', text: 'Compra de R$ 1,00 aprovada em LOJA 0' });
    expect(one.key).toBe(await batchKey((one.body as { events: { key: string }[] }).events.map((_, i) => `com.exemplo.banco|k${i}|${1000 + i}`)));
  });
  it('keeps notices offline, waits with exponential backoff and replays with the same key', async () => {
    const { native, queue } = fakeNative(A, 2), keys: string[] = [];
    let clock = 0;
    const offline = async (request: ApiRequest) => { keys.push(request.key!); throw new ApiError('offline', 'Sem conexão.'); };
    await expect(syncCaptures(native, A, offline, () => clock)).rejects.toMatchObject({ kind: 'offline' });
    expect(queue).toHaveLength(2);
    expect(await captureSyncState(A)).toMatchObject({ failures: 1, nextAttemptAt: CAPTURE_SYNC.baseDelayMs, lastError: 'Sem conexão.' });
    expect(await syncCaptures(native, A, offline, () => clock)).toMatchObject({ skipped: 'backoff' });
    clock = CAPTURE_SYNC.baseDelayMs;
    const calls: ApiRequest[] = [];
    await syncCaptures(native, A, async request => { keys.push(request.key!); return ok(calls)(request); }, () => clock);
    expect(keys[0]).toBe(keys[1]); expect(queue).toHaveLength(0);
    expect(await captureSyncState(A)).toMatchObject({ failures: 0, nextAttemptAt: 0, lastSyncAt: clock });
    expect([1, 2, 3, 10].map(backoff)).toEqual([60_000, 120_000, 240_000, 3_600_000]);
  });
  it('stops on an expired session without counting an attempt or losing notices', async () => {
    const { native, queue } = fakeNative(A, 1);
    await expect(syncCaptures(native, A, async () => { throw new ApiError('expired', 'Sessão expirada.', 401); })).rejects.toMatchObject({ kind: 'expired' });
    expect(queue).toHaveLength(1); expect((await captureSyncState(A)).failures).toBe(0);
  });
  it('drops a rejected batch only after the attempt limit', async () => {
    const { native, queue } = fakeNative(A, 1);
    const invalid = async () => { throw new ApiError('invalid', 'Confira os campos informados.', 400); };
    for (let attempt = 1; attempt < CAPTURE_SYNC.attempts; attempt++) {
      await expect(syncCaptures(native, A, invalid, () => 0, true)).rejects.toBeInstanceOf(ApiError);
      expect(queue).toHaveLength(1);
    }
    await expect(syncCaptures(native, A, invalid, () => 0, true)).rejects.toBeInstanceOf(ApiError);
    expect(queue).toHaveLength(0);
    expect(await captureSyncState(A)).toMatchObject({ rejected: 1, failures: 0 });
  });
  it('configures the listener only with the apps saved on the server, and turns it off when none remain', async () => {
    const { native, configured } = fakeNative(null, 0);
    const source = { package: 'com.exemplo.banco', label: 'Banco Exemplo', accountId: A, cardId: null };
    const echo = async (request: ApiRequest) => request.body;
    await saveCaptureSources(native, A, [source], echo);
    await saveCaptureSources(native, A, [], echo);
    expect(configured).toEqual([[A, ['com.exemplo.banco']], [null, []]]);
  });
});
