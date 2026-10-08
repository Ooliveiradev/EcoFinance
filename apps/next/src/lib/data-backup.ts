import { BACKUP_COLLECTIONS, DATA_LIMITS, RESTORE_CONFIRMATION, USER_BACKUP_FORMAT, USER_BACKUP_VERSION, centsToMoney, moneyToCents, restoreRequestSchema, type BackupCollection, type RestorePreview } from '@ecofinance/shared';
import type { Database, Models, OwnedCollection } from '@ecofinance/db';
import { FinanceError, fail, hash, operation, revision } from './finance-operation';
import { stableId } from './planning-lock';
import { importIdentity } from './import-store';

type Row = Record<string, unknown> & { id: string; ownerId: string };
export type Rows = Record<BackupCollection, Row[]>;
type Encoded = null | boolean | number | string | Encoded[] | { [key: string]: Encoded };
interface BackupSummary { counts: Record<BackupCollection, number>; entries: RestorePreview['totals'] }
export interface UserBackup {
  format: typeof USER_BACKUP_FORMAT; version: typeof USER_BACKUP_VERSION; ownerId: string; createdAt: string;
  collections: Record<BackupCollection, Encoded[]>; summary: BackupSummary; sha256: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, FIELD = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const MISSING_ORIGINAL = 'O arquivo original não faz parte do backup. Envie o arquivo novamente para analisar.';
function invalid(message = 'O arquivo não é um backup válido do EcoFinance; nenhum dado foi alterado.'): never { return fail('INVALID_BACKUP', 422, message); }
const each = <T>(build: (collection: BackupCollection) => T) => Object.fromEntries(BACKUP_COLLECTIONS.map(c => [c, build(c)])) as Record<BackupCollection, T>;

/** Every owned collection of the backup, read in one transaction. */
export async function ownedData(tx: Database, ownerId: string): Promise<Rows> {
  const lists = await Promise.all(BACKUP_COLLECTIONS.map(c => tx.owned(c as OwnedCollection, ownerId)));
  return each(c => (lists[BACKUP_COLLECTIONS.indexOf(c)] as unknown as Row[]).sort((a, b) => a.id.localeCompare(b.id)));
}
/** Optimistic-concurrency token over the user's whole data set (If-Match for restore/delete). */
export function dataRevision(rows: Rows) {
  return hash(BACKUP_COLLECTIONS.flatMap(c => [...rows[c]].sort((a, b) => a.id.localeCompare(b.id)).map(row => [c, row.id, revision(row as { revision?: string })])));
}
export const counts = (rows: Rows) => each(c => rows[c].length);
function summarize(rows: Rows): BackupSummary {
  const active = rows.transactions.filter(row => row.archivedAt == null);
  return { counts: counts(rows), entries: { entries: rows.transactions.length, archived: rows.transactions.length - active.length, amount: centsToMoney(active.reduce((sum, row) => sum + moneyToCents(String(row.amount)), 0n)) } };
}

function encode(value: unknown): Encoded {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));
  return value === undefined ? null : value as Encoded;
}
function decode(value: unknown, depth = 0): unknown {
  if (depth > 12) invalid();
  if (Array.isArray(value)) return value.map(v => decode(v, depth + 1));
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>, keys = Object.keys(object);
    if (keys.length === 1 && keys[0] === '$date') {
      const date = new Date(String(object.$date));
      if (typeof object.$date !== 'string' || Number.isNaN(date.getTime()) || date.toISOString() !== object.$date) invalid();
      return date;
    }
    return Object.fromEntries(keys.map(k => [k, decode(object[k], depth + 1)]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) invalid();
  return value;
}

/** Adds the reconciliation summary and integrity digest to an encoded backup body. */
export function sealBackup(body: Omit<UserBackup, 'summary' | 'sha256'>): UserBackup {
  const sealed = { ...body, summary: summarize(each(c => body.collections[c].map(value => decode(value) as Row))) };
  return { ...sealed, sha256: hash(sealed) };
}
/** Versioned export of the user's owned graph. Uploaded originals are temporary and excluded. */
export async function exportBackup(db: Database, ownerId: string): Promise<UserBackup> {
  const rows = await db.transaction(tx => ownedData(tx, ownerId));
  for (const batch of rows.importBatches) Object.assign(batch, { payload: null, processId: null });
  return sealBackup({ format: USER_BACKUP_FORMAT, version: USER_BACKUP_VERSION, ownerId, createdAt: new Date().toISOString(), collections: each(c => rows[c].map(encode)) });
}

/** Structural, integrity and reconciliation checks; nothing is read or written. */
export function readBackup(input: Record<string, unknown>): { backup: UserBackup; rows: Rows } {
  if (input.format !== USER_BACKUP_FORMAT) invalid();
  if (input.version !== USER_BACKUP_VERSION) fail('UNSUPPORTED_BACKUP_VERSION', 422, 'Este backup foi gerado por uma versão incompatível do EcoFinance. Atualize a instalação antes de restaurar.');
  const { sha256, ...body } = input;
  const collections = input.collections as Record<string, unknown> | null;
  if (typeof input.ownerId !== 'string' || !UUID.test(input.ownerId) || typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt)) ||
      !collections || typeof collections !== 'object' || Object.keys(collections).sort().join() !== [...BACKUP_COLLECTIONS].sort().join() ||
      BACKUP_COLLECTIONS.some(c => !Array.isArray(collections[c])) || !input.summary || typeof input.summary !== 'object') invalid();
  const total = BACKUP_COLLECTIONS.reduce((sum, c) => sum + (collections[c] as unknown[]).length, 0);
  if (total > DATA_LIMITS.restoreDocuments) fail('BACKUP_TOO_LARGE', 413, `A restauração pelo app aceita até ${DATA_LIMITS.restoreDocuments} registros em uma única transação. Use o backup operacional.`);
  if (typeof sha256 !== 'string' || hash(body) !== sha256) invalid('O arquivo de backup foi alterado ou está corrompido; nenhum dado foi alterado.');
  const owner = input.ownerId;
  const rows = each(c => {
    const list = (collections[c] as unknown[]).map(value => decode(value) as Row), ids = new Set<string>();
    for (const row of list) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !UUID.test(row.id) || ids.has(row.id) || row.ownerId !== owner) invalid('O backup mistura proprietários ou repete registros; nenhum dado foi alterado.');
      if (Object.keys(row).some(key => !FIELD.test(key))) invalid();
      ids.add(row.id);
    }
    return list;
  });
  let summary: BackupSummary;
  try { summary = summarize(rows); } catch { invalid(); }
  if (hash(summary) !== hash(input.summary)) invalid('Os totais do backup não conferem com os registros; nenhum dado foi alterado.');
  return { backup: input as unknown as UserBackup, rows };
}

const TEXT = new Set(['description', 'notes', 'name', 'displayName', 'filename', 'mime', 'error', 'format', 'accountHint', 'externalId', 'idempotencyKey', 'legacyKey', 'icon', 'color', 'fileHash', 'storageKey', 'excerpt', 'cell', 'warnings', 'undoReason', 'originAddress', 'destinationAddress', 'driverName']);
/**
 * Adopting another owner's backup (e.g. a new installation) gives every record a
 * new deterministic identity, so it never collides with other users' documents.
 * Identities the app derives from the owner (months, budgets, invoices,
 * occurrences, import rows/entries) are re-derived only when the original id
 * matches its recipe, keeping lookups and duplicate detection working.
 */
function adopt(rows: Rows, from: string, to: string): Rows {
  const ids = new Map<string, string>(), fresh = (id: string) => stableId(['restore', to, id]);
  for (const c of BACKUP_COLLECTIONS) for (const row of rows[c]) ids.set(row.id, fresh(row.id));
  const map = (value: unknown) => typeof value === 'string' ? ids.get(value) ?? fresh(value) : value;
  const month = (row: Row) => String(row.competenceMonth).slice(0, 7);
  const derive = (row: Row, before: unknown[], after: unknown[]) => { if (row.id === stableId(before)) ids.set(row.id, stableId(after)); };
  for (const r of rows.budgets) derive(r, ['budget', from, month(r)], ['budget', to, month(r)]);
  for (const r of rows.planningMonths) derive(r, ['month', from, month(r)], ['month', to, month(r)]);
  for (const r of rows.invoices) derive(r, ['invoice', from, r.cardId, month(r)], ['invoice', to, map(r.cardId), month(r)]);
  for (const r of rows.recurrenceOccurrences) derive(r, ['occurrence', from, r.ruleId, month(r)], ['occurrence', to, map(r.ruleId), month(r)]);
  for (const r of rows.importItems) derive(r, ['import-item', r.batchId, r.position], ['import-item', map(r.batchId), r.position]);
  for (const r of rows.budgetCategories) derive(r, ['budget-category', from, r.budgetId, r.categoryId], ['budget-category', to, map(r.budgetId), map(r.categoryId)]);
  const batches = new Map(rows.importBatches.map(batch => [batch.id, batch]));
  for (const item of rows.importItems) {
    const batch = batches.get(String(item.batchId)) as unknown as Models['importBatches'] | undefined;
    if (!batch || typeof item.transactionId !== 'string' || item.transactionId !== importIdentity(batch, item as unknown as Models['importItems'])) continue;
    ids.set(item.transactionId, importIdentity({ ...batch, ownerId: to, accountId: map(batch.accountId) as string | null, cardId: map(batch.cardId) as string | null }, item as unknown as Models['importItems']));
  }
  const rewrite = (value: unknown, key: string): unknown => {
    if (typeof value === 'string') return !TEXT.has(key) && UUID.test(value) ? map(value) : value;
    if (Array.isArray(value)) return value.map(v => rewrite(v, key));
    if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'ownerId' ? to : rewrite(v, k)]));
    return value;
  };
  return each(c => rows[c].map(row => rewrite(row, '') as Row));
}
function prepare(rows: Rows, from: string, to: string): Rows {
  const next = from === to ? rows : adopt(rows, from, to);
  next.importBatches = next.importBatches.map(batch => ['received', 'processing'].includes(String(batch.state)) ? { ...batch, state: 'failed', payload: null, processId: null, error: MISSING_ORIGINAL } : { ...batch, payload: null, processId: null });
  return next;
}
/** Refunds and reconciliations reference other entries: parents are written first. */
function ordered(rows: Row[]) {
  const byId = new Map(rows.map(row => [row.id, row])), state = new Map<string, number>(), out: Row[] = [];
  const visit = (row: Row) => {
    if (state.get(row.id) === 2) return;
    if (state.get(row.id) === 1) invalid('O backup tem vínculos circulares entre lançamentos; nenhum dado foi alterado.');
    state.set(row.id, 1);
    for (const key of ['refundOfId', 'reconciledIntoId']) { const parent = byId.get(String(row[key])); if (parent) visit(parent); }
    state.set(row.id, 2); out.push(row);
  };
  rows.forEach(visit);
  return out;
}
/** Sequential on purpose: each put validates against parents and unique claims staged by the previous ones. */
function inOrder<T>(items: T[], step: (item: T) => Promise<void>) {
  return items.reduce((chain, item) => chain.then(() => step(item)), Promise.resolve());
}
/** Replaces the owner's graph inside the caller's transaction; the store revalidates every invariant and link. */
async function replace(tx: Database, ownerId: string, current: Rows, next: Rows) {
  try {
    await Promise.all(BACKUP_COLLECTIONS.flatMap(c => [tx.prefetch(c, current[c]), tx.prefetch(c, next[c])]));
    // Erasures are independent once prefetched; writes are not (see inOrder).
    await Promise.all(BACKUP_COLLECTIONS.flatMap(c => current[c].map(row => tx.erase(c, row.id, ownerId))));
    // Occurrence ↔ entry links are circular: write the occurrence, then its entry, then the link.
    const deferred = next.recurrenceOccurrences.filter(row => row.transactionId != null), linked = new Set(deferred);
    const writes = BACKUP_COLLECTIONS.flatMap(c => (c === 'transactions' ? ordered(next[c]) : next[c]).map(row => ({ c, row: linked.has(row) ? { ...row, transactionId: null } : row })));
    await inOrder(writes, ({ c, row }) => tx.put(c, row as never, true));
    await inOrder(deferred, row => tx.put('recurrenceOccurrences', row as never));
  } catch (error) {
    // Firestore/gRPC errors carry numeric codes and must keep their retry semantics.
    if (error instanceof FinanceError || typeof (error as { code?: unknown })?.code === 'number') throw error;
    invalid('O backup tem valores ou vínculos inválidos para esta conta; nenhum dado foi alterado.');
  }
}
class DryRun extends Error { constructor(public preview: RestorePreview) { super('dry-run'); } }

/** Validates the whole restore in a transaction that is always rolled back. */
export async function previewRestore(db: Database, ownerId: string, input: unknown): Promise<RestorePreview> {
  const request = restoreRequestSchema.parse(input);
  const { backup, rows } = readBackup(request.backup);
  const next = prepare(rows, backup.ownerId, ownerId);
  try {
    await db.transaction(async tx => {
      const current = await ownedData(tx, ownerId);
      const preview = { createdAt: backup.createdAt, foreignOwner: backup.ownerId !== ownerId, currentRevision: dataRevision(current), sha256: backup.sha256, backup: counts(next), current: counts(current), totals: summarize(next).entries };
      await replace(tx, ownerId, current, next);
      throw new DryRun(preview);
    });
  } catch (error) { if (error instanceof DryRun) return error.preview; throw error; }
  return fail('UNAVAILABLE', 503, 'Prévia indisponível.');
}
export interface RestoreResult { restored: Record<BackupCollection, number>; totals: RestorePreview['totals']; revision: string }
export async function restoreBackup(db: Database, ownerId: string, requestId: string, input: unknown, expected: string): Promise<RestoreResult> {
  const request = restoreRequestSchema.parse(input);
  if (request.confirm !== RESTORE_CONFIRMATION) fail('CONFIRMATION_REQUIRED', 400, 'Confirme que os dados atuais serão substituídos pelo backup.');
  const { backup, rows } = readBackup(request.backup);
  if (backup.ownerId !== ownerId && request.ownerMode !== 'adopt') fail('FOREIGN_BACKUP', 409, 'Este backup pertence a outra conta. Confirme explicitamente a adoção dos dados para continuar.');
  const next = prepare(rows, backup.ownerId, ownerId);
  return await operation(db, ownerId, requestId, 'restore-backup', { sha256: backup.sha256, ownerMode: request.ownerMode, expected }, async tx => {
    const current = await ownedData(tx, ownerId);
    if (!expected || dataRevision(current) !== expected) fail('REVISION_CONFLICT', 409, 'Seus dados mudaram depois da prévia. Gere a prévia novamente.');
    await replace(tx, ownerId, current, next);
    return { restored: counts(next), totals: summarize(next).entries, revision: dataRevision(next) };
  }) as unknown as RestoreResult;
}
