import { randomUUID } from 'node:crypto';
import { IMPORT_ORIGINAL_RETENTION_DAYS } from '@ecofinance/shared';
import type { DocumentStore } from './firestore';
import type { Models } from './models';

type Batch = Models['importBatches'];
const DAY = 86_400_000;
/** Originals are temporary: an explicit expiresAt wins, otherwise the retention window from upload. */
export function originalExpiresAt(batch: Pick<Batch, 'createdAt' | 'expiresAt'>) {
  return batch.expiresAt ?? new Date(batch.createdAt.getTime() + IMPORT_ORIGINAL_RETENTION_DAYS * DAY);
}
/**
 * Drops only the uploaded bytes. Extracted rows under review stay usable and
 * confirmed entries never depend on the original; unanalysed files fail with
 * an actionable message instead of keeping the payload.
 */
export function withoutOriginal(batch: Batch, reason: string, now = new Date()): Batch {
  const reviewable = batch.state === 'review';
  return { ...batch, payload: null, processId: null, state: reviewable ? batch.state : ['received', 'processing', 'failed'].includes(batch.state) ? 'failed' : batch.state,
    error: reviewable ? batch.error ?? null : reason, revision: randomUUID(), updatedAt: now };
}
export const EXPIRED_ORIGINAL = `O arquivo original foi apagado após ${IMPORT_ORIGINAL_RETENTION_DAYS} dias. Envie o arquivo novamente para analisar.`;
/** Idempotent sweep. With ownerId it only reads that owner's batches. */
export async function expireImportOriginals(store: DocumentStore, now = new Date(), ownerId?: string) {
  const where = [{ field: 'payload', op: 'ne' as const, value: null }];
  const candidates = ownerId ? await store.owned('importBatches', ownerId, { where }) : await store.query('importBatches', { where });
  let expired = 0;
  for (const candidate of candidates.filter(batch => originalExpiresAt(batch) <= now)) {
    expired += await store.transaction(async tx => {
      const current = await tx.get('importBatches', candidate.id);
      if (!current || current.payload == null || originalExpiresAt(current) > now) return 0;
      await tx.put('importBatches', withoutOriginal(current, EXPIRED_ORIGINAL, now));
      return 1;
    });
  }
  return expired;
}
