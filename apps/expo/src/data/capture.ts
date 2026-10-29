import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import type { CaptureSource } from '@ecofinance/shared';
import type { CaptureNative, CaptureStatus } from '../../modules/ecofinance-capture';
import { ApiError, apiRequest, type ApiRequest } from './api';
import { readLocal, writeLocal } from './local-store';

/**
 * Optional expense capture (#19) on Android. The native listener keeps eligible
 * notices in a private queue tagged with the user; this module sends them to the
 * server, which stages them for review. Sending is idempotent per batch of notices,
 * retried with backoff and never crosses accounts.
 */
export const CAPTURE_SYNC = { batch: 50, attempts: 8, baseDelayMs: 60_000, maxDelayMs: 60 * 60_000 } as const;
interface SyncState { deviceId: string; failures: number; nextAttemptAt: number; lastSyncAt: number | null; lastError: string | null; rejected: number }
export interface CaptureSyncResult { sent: number; accepted: number; repeated: number; ignored: number; skipped?: 'backoff' | 'empty' | 'unavailable' }
type Send = (request: ApiRequest) => Promise<unknown>;

/** The device id is created once per user on this install and kept with the sync state. */
async function state(userId: string): Promise<SyncState> {
  const stored = await readLocal<SyncState>(userId, 'capture-sync');
  if (stored) return stored;
  const created = { deviceId: randomUUID(), failures: 0, nextAttemptAt: 0, lastSyncAt: null, lastError: null, rejected: 0 };
  await writeLocal(userId, 'capture-sync', created);
  return created;
}
export const captureSyncState = state;
/** Same notices, same key: a lost response replayed by the next attempt is not staged twice. */
export async function batchKey(ids: string[]) {
  return 'capture-' + (await digestStringAsync(CryptoDigestAlgorithm.SHA256, ids.join('\n'))).slice(0, 32);
}
export const backoff = (failures: number) => Math.min(CAPTURE_SYNC.maxDelayMs, CAPTURE_SYNC.baseDelayMs * 2 ** Math.max(0, failures - 1));

/**
 * Sends the oldest queued notices of `userId`. Offline/unavailable keeps them for a
 * later attempt with exponential backoff; an expired session keeps them without
 * counting a failure; a rejected payload is dropped after the attempt limit so a
 * malformed notice cannot block the queue forever.
 */
export async function syncCaptures(native: CaptureNative | null, userId: string, send: Send = apiRequest, now = () => Date.now(), force = false): Promise<CaptureSyncResult> {
  const none = { sent: 0, accepted: 0, repeated: 0, ignored: 0 };
  if (!native || native.status().owner !== userId) return { ...none, skipped: 'unavailable' };
  const current = await state(userId);
  if (!force && current.nextAttemptAt > now()) return { ...none, skipped: 'backoff' };
  const notices = native.peek(CAPTURE_SYNC.batch);
  if (!notices.length) return { ...none, skipped: 'empty' };
  const ids = notices.map(notice => notice.id);
  try {
    const result = await send({ method: 'POST', path: '/api/captures/events', key: await batchKey(ids), userId,
      body: { deviceId: current.deviceId, events: notices.map(({ id: _id, ...event }) => event) } }) as { accepted: number; repeated: number; ignored: Record<string, number> };
    native.remove(ids);
    await writeLocal(userId, 'capture-sync', { ...current, failures: 0, nextAttemptAt: 0, lastSyncAt: now(), lastError: null });
    return { sent: ids.length, accepted: result.accepted, repeated: result.repeated, ignored: Object.values(result.ignored ?? {}).reduce((sum, count) => sum + count, 0) };
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError('unavailable', 'Falha ao enviar.');
    if (failure.kind === 'expired' || failure.kind === 'forbidden') throw failure;
    const failures = current.failures + 1, rejected = failure.kind === 'invalid' && failures >= CAPTURE_SYNC.attempts;
    if (rejected) native.remove(ids);
    await writeLocal(userId, 'capture-sync', { ...current, failures: rejected ? 0 : failures, nextAttemptAt: rejected ? 0 : now() + backoff(failures),
      lastError: failure.message, rejected: current.rejected + (rejected ? ids.length : 0) });
    throw failure;
  }
}
export async function loadCaptureSources(): Promise<CaptureSource[]> {
  return (await apiRequest<{ sources: CaptureSource[] }>({ path: '/api/captures/sources' })).sources;
}
/** Saves on the server first, then tells the listener which packages to keep for this user. */
export async function saveCaptureSources(native: CaptureNative | null, userId: string, sources: CaptureSource[], send: Send = apiRequest) {
  const saved = await send({ method: 'PUT', path: '/api/captures/sources', key: randomUUID(), userId, body: { sources } }) as { sources: CaptureSource[] };
  native?.configure(saved.sources.length ? userId : null, saved.sources.map(source => source.package));
  return saved.sources;
}
/** Logout or account switch: the queue and filters of the previous user are erased. */
export function stopCapture(native: CaptureNative | null) { native?.clear(); }
export type { CaptureStatus };
