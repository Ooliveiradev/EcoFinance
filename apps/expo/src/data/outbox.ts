import { randomUUID } from 'expo-crypto';
import { apiRequest, ApiError, toApiError, type ApiRequest } from './api';
import { readLocal, writeLocal } from './local-store';

/** What a queued change refers to, so a conflict can be re-read and resolved. */
export type ResourceRef =
  | { type: 'entry' | 'account' | 'category' | 'card'; id: string }
  | { type: 'occurrence'; id: string; month: string }
  | { type: 'budget'; month: string }
  | { type: 'invoice'; cardId: string; month: string };
export interface Mutation {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  ifMatch: string | null;
  /** Shown in the pending list, e.g. "Novo lançamento: Mercado". */
  label: string;
  resource: ResourceRef | null;
  /** Freeform kind used by screens to find their own drafts (e.g. `entry:create`). */
  kind: string;
}
export type OutboxState = 'pending' | 'conflict' | 'rejected';
export interface OutboxItem extends Mutation {
  id: string;
  /** Idempotency-Key reused on every replay of this exact intent. */
  key: string;
  createdAt: string;
  /** Sends that may have reached the server. A sent intent is never edited, only replayed or discarded. */
  attempts: number;
  state: OutboxState;
  error: string | null;
}
export type SubmitOutcome =
  | { status: 'synced'; result: unknown }
  | { status: 'pending'; reason: 'offline' | 'unavailable' | 'expired' }
  | { status: 'conflict' | 'rejected'; message: string };
export type Sender = (request: ApiRequest) => Promise<unknown>;

const NAME = 'outbox';
const listeners = new Set<(userId: string) => void>();
let queue: Promise<unknown> = Promise.resolve();
const flushing = new Map<string, Promise<FlushResult>>();

/** Read-modify-write of the outbox is serialized so a replay and an edit cannot overwrite each other. */
function locked<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
}
async function read(userId: string) { return await readLocal<OutboxItem[]>(userId, NAME) ?? []; }
async function change<T>(userId: string, update: (items: OutboxItem[]) => { items: OutboxItem[]; value: T }): Promise<T> {
  const value = await locked(async () => {
    const next = update(await read(userId));
    await writeLocal(userId, NAME, next.items);
    return next.value;
  });
  for (const listener of listeners) listener(userId);
  return value;
}
export function onOutboxChange(listener: (userId: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function listOutbox(userId: string): Promise<OutboxItem[]> { return locked(() => read(userId)); }
export function sameResource(a: ResourceRef | null, b: ResourceRef | null) {
  return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}
/** Only an intent that certainly did not reach the server may change its data (and gets a new key). */
export function editable(item: OutboxItem) { return item.attempts === 0 || item.state !== 'pending'; }
export class OutboxBusy extends Error {}

/**
 * Adds a change to the per-user outbox. `replaceId` edits an existing draft. A
 * second change to the same record replaces the earlier draft so that it does
 * not conflict with its own revision, unless the earlier one may already have
 * been applied: then the user must sync (or discard) first.
 */
export function enqueue(userId: string, mutation: Mutation, replaceId?: string, now = () => new Date()): Promise<OutboxItem> {
  return change(userId, items => {
    const previous = items.find(item => item.id === replaceId || (!replaceId && sameResource(item.resource, mutation.resource)));
    if (replaceId && !previous) throw new OutboxBusy('O rascunho já foi enviado ou descartado.');
    if (previous && !editable(previous)) throw new OutboxBusy('Há uma alteração deste registro aguardando confirmação do servidor. Sincronize antes de alterar de novo.');
    const item: OutboxItem = { ...mutation, id: previous?.id ?? randomUUID(), key: randomUUID(), createdAt: previous?.createdAt ?? now().toISOString(), attempts: 0, state: 'pending', error: null };
    return { items: previous ? items.map(row => row.id === previous.id ? item : row) : [...items, item], value: item };
  });
}
export function discard(userId: string, id: string) {
  return change(userId, items => ({ items: items.filter(item => item.id !== id), value: undefined }));
}
/** Conflict resolution "keep mine": the same change, explicitly re-based on the revision the user reviewed. */
export function reapply(userId: string, id: string, revision: string) {
  return change(userId, items => {
    const item = items.find(row => row.id === id);
    if (!item || item.state !== 'conflict') throw new OutboxBusy('Este conflito já foi resolvido.');
    return { items: items.map(row => row.id === id ? { ...row, ifMatch: revision, key: randomUUID(), attempts: 0, state: 'pending' as const, error: null } : row), value: undefined };
  });
}

export interface FlushResult {
  sent: Map<string, unknown>;
  stopped: 'offline' | 'unavailable' | 'expired' | null;
}
const send: Sender = request => apiRequest(request);

/**
 * Replays pending changes in order with their original Idempotency-Key and
 * If-Match. A lost response is therefore safe to replay: the server returns the
 * first result instead of applying twice. Stops at the first connectivity or
 * session failure so later changes never overtake earlier ones.
 */
export function flush(userId: string, sender: Sender = send): Promise<FlushResult> {
  const previous = flushing.get(userId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => replay(userId, sender));
  flushing.set(userId, run);
  void run.finally(() => { if (flushing.get(userId) === run) flushing.delete(userId); }).catch(() => undefined);
  return run;
}
async function replay(userId: string, sender: Sender): Promise<FlushResult> {
  const result: FlushResult = { sent: new Map(), stopped: null };
  const tried = new Set<string>();
  for (;;) {
    // Write-ahead: count the attempt before sending, so a crash mid-request keeps the item replay-only.
    const item = await change(userId, items => {
      const next = items.find(row => row.state === 'pending' && !tried.has(row.id));
      return { items: next ? items.map(row => row === next ? { ...row, attempts: row.attempts + 1 } : row) : items, value: next };
    });
    if (!item) return result;
    tried.add(item.id);
    let outcome: { ok: true; value: unknown } | { ok: false; error: ApiError };
    try {
      outcome = { ok: true, value: await sender({ method: item.method, path: item.path, body: item.body, key: item.key, ifMatch: item.ifMatch, userId }) };
    } catch (raw) {
      outcome = { ok: false, error: toApiError(raw) };
    }
    if (outcome.ok) {
      result.sent.set(item.id, outcome.value);
      await change(userId, items => ({ items: items.filter(row => row.id !== item.id), value: undefined }));
      continue;
    }
    const error = outcome.error;
    if (error.kind === 'offline' || error.kind === 'unavailable' || error.kind === 'expired') {
      // 401 is answered before any write: this attempt certainly did not apply.
      if (error.kind === 'expired') await change(userId, items => ({ items: items.map(row => row.id === item.id ? { ...row, attempts: Math.max(0, row.attempts - 1) } : row), value: undefined }));
      result.stopped = error.kind;
      return result;
    }
    const state: OutboxState = error.kind === 'conflict' && (error.code === 'REVISION_CONFLICT' || error.code === null) ? 'conflict' : 'rejected';
    await change(userId, items => ({ items: items.map(row => row.id === item.id ? { ...row, state, error: error.message } : row), value: undefined }));
  }
}

/** Queues a change and tries to send it now; offline it stays as an identified pending draft. */
export async function submit(userId: string, mutation: Mutation, replaceId?: string, sender: Sender = send): Promise<SubmitOutcome> {
  // The replay must start after the item is stored, never concurrently with it.
  const { item, result } = await enqueue(userId, mutation, replaceId).then(async queued => ({ item: queued, result: await flush(userId, sender) }));
  if (result.sent.has(item.id)) return { status: 'synced', result: result.sent.get(item.id) };
  const current = (await listOutbox(userId)).find(row => row.id === item.id);
  if (!current) return { status: 'synced', result: null };
  if (current.state === 'pending') return { status: 'pending', reason: result.stopped ?? 'offline' };
  return { status: current.state, message: current.error ?? 'Não foi possível salvar.' };
}
