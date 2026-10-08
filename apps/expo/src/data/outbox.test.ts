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
import { ApiError, apiRequest, type ApiRequest } from './api';
import { discard, enqueue, flush, listOutbox, OutboxBusy, reapply, submit, type Mutation } from './outbox';

const A = '10000000-0000-4000-8000-00000000000a', B = '10000000-0000-4000-8000-00000000000b';
const ENTRY = '20000000-0000-4000-8000-000000000001';
const create: Mutation = { method: 'POST', path: '/api/entries', body: { description: 'Mercado', amount: '10.00' }, ifMatch: null, label: 'Novo lançamento: Mercado', resource: null, kind: 'entry:create' };
const edit = (description: string, ifMatch = 'r1'): Mutation => ({ method: 'PATCH', path: `/api/entries/${ENTRY}`, body: { description }, ifMatch, label: 'Editar', resource: { type: 'entry', id: ENTRY }, kind: 'entry:update' });
const offline = () => new ApiError('offline', 'Sem conexão com o servidor.');

beforeEach(() => storage.clear());
afterEach(() => { vi.unstubAllGlobals(); secure.value = null; });

describe('offline outbox', () => {
  it('keeps an offline change as an identified pending draft and replays it later with the same key', async () => {
    const sender = vi.fn<(request: ApiRequest) => Promise<unknown>>().mockRejectedValueOnce(offline()).mockResolvedValueOnce({ id: ENTRY, revision: 'r1' });
    expect(await submit(A, create, undefined, sender)).toEqual({ status: 'pending', reason: 'offline' });
    const [pending] = await listOutbox(A);
    expect(pending).toMatchObject({ state: 'pending', attempts: 1, label: 'Novo lançamento: Mercado' });
    const result = await flush(A, sender);
    expect(result.sent.get(pending!.id)).toEqual({ id: ENTRY, revision: 'r1' });
    expect(sender.mock.calls[0]![0].key).toBe(pending!.key);
    expect(sender.mock.calls[1]![0].key).toBe(pending!.key);
    expect(sender.mock.calls[1]![0]).toMatchObject({ method: 'POST', path: '/api/entries', userId: A });
    expect(await listOutbox(A)).toEqual([]);
  });

  it('replays a request whose response was lost with identical Idempotency-Key and If-Match', async () => {
    const sender = vi.fn<(request: ApiRequest) => Promise<unknown>>()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce({ id: ENTRY, revision: 'r2' });
    await submit(A, edit('Aluguel'), undefined, sender);
    await flush(A, sender);
    const [first, second] = sender.mock.calls.map(call => call[0]);
    expect(second!.key).toBe(first!.key);
    expect(second!.ifMatch).toBe('r1');
    expect(second!.body).toEqual(first!.body);
  });

  it('never edits an intent that may have reached the server, but merges a draft never sent', async () => {
    await enqueue(A, edit('Primeira'));
    await enqueue(A, edit('Segunda'));
    const drafts = await listOutbox(A);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toEqual({ description: 'Segunda' });
    await flush(A, vi.fn().mockRejectedValue(offline()));
    await expect(enqueue(A, edit('Terceira'))).rejects.toBeInstanceOf(OutboxBusy);
    await expect(enqueue(A, create, drafts[0]!.id)).rejects.toBeInstanceOf(OutboxBusy);
  });

  it('marks revision conflicts for resolution, keeps sending the rest and re-bases only on explicit reapply', async () => {
    const sender = vi.fn<(request: ApiRequest) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError('conflict', 'O registro foi alterado. Recarregue antes de salvar.', 409, 'REVISION_CONFLICT'))
      .mockResolvedValueOnce({ id: 'created' });
    await enqueue(A, edit('Minha versão'));
    await enqueue(A, create);
    const result = await flush(A, sender);
    expect(result.stopped).toBeNull();
    const [conflict] = await listOutbox(A);
    expect(conflict).toMatchObject({ state: 'conflict', error: 'O registro foi alterado. Recarregue antes de salvar.' });
    await flush(A, sender);
    expect(sender).toHaveBeenCalledTimes(2);
    await reapply(A, conflict!.id, 'r9');
    sender.mockResolvedValueOnce({ id: ENTRY, revision: 'r10' });
    await flush(A, sender);
    const replay = sender.mock.calls[2]![0];
    expect(replay.ifMatch).toBe('r9');
    expect(replay.key).not.toBe(conflict!.key);
    expect(await listOutbox(A)).toEqual([]);
  });

  it('rejects validation failures without blocking, and lets the draft be corrected with a new key', async () => {
    const sender = vi.fn().mockRejectedValueOnce(new ApiError('invalid', 'Confira os campos informados.', 400, 'INVALID_INPUT'));
    expect(await submit(A, create, undefined, sender)).toEqual({ status: 'rejected', message: 'Confira os campos informados.' });
    const [rejected] = await listOutbox(A);
    const fixed = await enqueue(A, { ...create, body: { description: 'Mercado', amount: '12.00' } }, rejected!.id);
    expect(fixed.id).toBe(rejected!.id);
    expect(fixed.key).not.toBe(rejected!.key);
    expect(fixed.state).toBe('pending');
    await discard(A, fixed.id);
    expect(await listOutbox(A)).toEqual([]);
  });

  it('preserves order: an offline failure stops later changes from overtaking it', async () => {
    const sender = vi.fn().mockRejectedValue(offline());
    await enqueue(A, edit('Primeiro'));
    await enqueue(A, create);
    const result = await flush(A, sender);
    expect(result.stopped).toBe('offline');
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('stops on expired session without counting the refused attempt', async () => {
    const sender = vi.fn().mockRejectedValue(new ApiError('expired', 'Sessão expirada.'));
    expect(await submit(A, edit('Depois do login'), undefined, sender)).toEqual({ status: 'pending', reason: 'expired' });
    const [item] = await listOutbox(A);
    expect(item).toMatchObject({ state: 'pending', attempts: 0 });
    await enqueue(A, edit('Corrigido'));
    expect((await listOutbox(A))[0]!.body).toEqual({ description: 'Corrigido' });
  });

  it('isolates drafts per user and serializes concurrent replays (one send per intent)', async () => {
    await enqueue(A, create);
    expect(await listOutbox(B)).toEqual([]);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const sender = vi.fn().mockImplementation(async () => { await gate; return { id: 'x' }; });
    const first = flush(A, sender), second = flush(A, sender);
    release();
    await Promise.all([first, second]);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('refuses to replay a draft with the credential of a different account', async () => {
    secure.value = JSON.stringify({ url: 'https://api.example.test', credential: 'synthetic.signed', userId: B });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await enqueue(A, create);
    const result = await flush(A, request => apiRequest(request));
    expect(result.stopped).toBe('expired');
    expect(fetch).not.toHaveBeenCalled();
    expect(await listOutbox(A)).toHaveLength(1);
  });
});
