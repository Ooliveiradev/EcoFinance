import { randomUUID } from 'expo-crypto';
import { IMPORT_LIMITS, importReviewSchema, type ImportBatchView, type ImportRowView } from '@ecofinance/shared';
import { apiRequest } from './api';
import { fieldErrors, parseMoneyInput } from './format';

/** What the document picker returned; files are read by the native fetch from their local URI. */
export interface PickedFile { uri: string; name: string; mimeType: string | null; size: number | null }
export type ImportTarget = { accountId: string; cardId: null } | { accountId: null; cardId: string };

export function checkPicked(files: PickedFile[]): string | null {
  if (!files.length) return 'Selecione ao menos um arquivo.';
  if (files.length > IMPORT_LIMITS.files) return `Selecione até ${IMPORT_LIMITS.files} arquivos.`;
  const large = files.find(file => file.size !== null && file.size > IMPORT_LIMITS.bytes);
  if (large) return `${large.name} tem mais de ${IMPORT_LIMITS.bytes / 1024} KiB. Exporte um período menor.`;
  return null;
}
/**
 * One Idempotency-Key per intent: retrying the same action on the same version
 * (for example after a lost response) reuses the key, so the server answers with
 * the first result instead of creating a second batch or commit.
 */
export function intentKey(keys: Map<string, string>, signature: string): string {
  let key = keys.get(signature);
  if (!key) { key = randomUUID(); keys.set(signature, key); }
  return key;
}
export function uploadSignature(files: PickedFile[], target: ImportTarget) {
  return JSON.stringify([target, files.map(file => [file.name, file.size, file.uri])]);
}
export async function uploadImports(files: PickedFile[], target: ImportTarget, key: string) {
  const form = new FormData();
  for (const file of files) {
    // React Native's FormData streams a file part from {uri, name, type}.
    form.append('files', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  }
  if (target.accountId) form.append('accountId', target.accountId);
  if (target.cardId) form.append('cardId', target.cardId);
  return apiRequest<{ batches: { id: string; revision: string }[] }>({ method: 'POST', path: '/api/imports', form, key });
}
export function processBatch(batch: { id: string; revision: string }, key: string) {
  return apiRequest<ImportBatchView>({ method: 'POST', path: `/api/imports/${batch.id}/process`, body: {}, key, ifMatch: batch.revision });
}
export type BatchAction = 'confirm' | 'undo' | 'cancel';
export function batchAction(batch: ImportBatchView, action: BatchAction, key: string) {
  return apiRequest<unknown>({ method: 'POST', path: `/api/imports/${batch.id}/${action}`, body: action === 'cancel' ? {} : { confirmed: true }, key, ifMatch: batch.revision });
}
export type ReviewPatch = Partial<Pick<ImportRowView, 'description' | 'amount' | 'purchaseDate' | 'competenceMonth' | 'categoryId' | 'selected' | 'resolution' | 'duplicateId'>>;
export interface ReviewForm {
  description: string; amount: string; purchaseDate: string; competenceMonth: string;
  categoryId: string; selected: boolean; resolution: ImportRowView['resolution']; duplicateId: string | null;
}
export interface ReviewDraft { base: ImportRowView; form: ReviewForm; saved: boolean; errors: Record<string, string> }
export function reviewForm(row: ImportRowView): ReviewForm {
  return {
    description: row.description ?? '', amount: row.amount?.replace('.', ',') ?? '', purchaseDate: row.purchaseDate ?? '',
    competenceMonth: row.competenceMonth?.slice(0, 7) ?? '', categoryId: row.categoryId ?? '',
    selected: row.selected, resolution: row.resolution, duplicateId: row.duplicateId,
  };
}
/** A successful save stays pending until a fresh row version replaces the old preview. */
export function pendingReview(draft: ReviewDraft | undefined, row: ImportRowView): ReviewDraft | undefined {
  return draft && (!draft.saved || draft.base.revision === row.revision) ? draft : undefined;
}
export function reviewFormBody(row: ImportRowView, form: ReviewForm) {
  const amount = parseMoneyInput(form.amount);
  const result = reviewBody(row, { ...form, amount, competenceMonth: `${form.competenceMonth}-01`, selected: form.resolution !== 'exclude' && form.selected });
  if (!amount) return { ok: false as const, errors: { ...(!result.ok ? result.errors : {}), amount: 'Informe um valor como -1.234,56.' } };
  return result;
}
/** Builds the shared review payload for one row; invalid rows report why instead of being sent. */
export function reviewBody(row: ImportRowView, patch: ReviewPatch) {
  const next = { ...row, ...patch };
  const parsed = importReviewSchema.safeParse({
    description: next.description, amount: next.amount, purchaseDate: next.purchaseDate, competenceMonth: next.competenceMonth,
    categoryId: next.categoryId, selected: next.selected, resolution: next.resolution,
    duplicateId: next.resolution === 'link' ? next.duplicateId : null,
  });
  return parsed.success ? { ok: true as const, body: parsed.data } : { ok: false as const, errors: fieldErrors(parsed.error) };
}
export function reviewItem(batchId: string, row: ImportRowView, body: unknown, key: string) {
  return apiRequest<unknown>({ method: 'PATCH', path: `/api/imports/${batchId}/items/${row.id}`, body, key, ifMatch: row.revision });
}
export const BATCH_STATE: Record<string, string> = {
  received: 'recebido', processing: 'em análise', review: 'em revisão', confirmed: 'confirmado', failed: 'falhou', cancelled: 'cancelado', reverted: 'desfeito',
};
