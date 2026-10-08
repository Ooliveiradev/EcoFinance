import { ApiError, toApiError } from './api';
import { readLocal, writeLocal } from './local-store';

export interface Loaded<T> {
  data: T;
  /** `cache` means the server could not be reached and this is the last confirmed copy. */
  source: 'network' | 'cache';
  savedAt: string;
  /** Why the copy is from cache; null for fresh data. */
  error: ApiError | null;
}
interface Entry<T> { savedAt: string; data: T }

/**
 * Network first. Only connection and availability failures fall back to the last
 * copy confirmed by the server for this same user; without one, the error is
 * surfaced instead of an empty list or zero totals. Expired sessions, conflicts
 * and validation errors are never hidden behind cached data.
 */
export async function loadWithCache<T>(userId: string, name: string, fetcher: () => Promise<T>, now = () => new Date()): Promise<Loaded<T>> {
  try {
    const data = await fetcher();
    const savedAt = now().toISOString();
    // A full device storage must not hide data the server just returned.
    await writeLocal(userId, 'cache.' + name, { savedAt, data } satisfies Entry<T>).catch(() => undefined);
    return { data, source: 'network', savedAt, error: null };
  } catch (raw) {
    const error = toApiError(raw);
    if (error.kind !== 'offline' && error.kind !== 'unavailable') throw error;
    const cached = await readLocal<Entry<T>>(userId, 'cache.' + name).catch(() => null);
    if (!cached) throw error;
    return { data: cached.data, source: 'cache', savedAt: cached.savedAt, error };
  }
}
export function cacheName(...parts: string[]) {
  return parts.map(part => part.replace(/[^a-z0-9_-]/gi, '_')).join('.');
}
