import { BACKUP_COLLECTIONS, DATA_LIMITS, IMPORT_ORIGINAL_RETENTION_DAYS, deleteDataSchema, entriesCsv, entriesExportSchema, type DataSummary } from '@ecofinance/shared';
import { expireImportOriginals, originalExpiresAt, withoutOriginal, type Database, type Models, type Predicate } from '@ecofinance/db';
import { checkRevision, fail, operation, owned, revision } from './finance-operation';
import { counts, dataRevision, ownedData } from './data-backup';

/** Settings overview; expired originals are removed before they are listed. */
export async function dataSummary(db: Database, ownerId: string): Promise<DataSummary> {
  await expireImportOriginals(db, new Date(), ownerId);
  const rows = await db.transaction(tx => ownedData(tx, ownerId));
  const originals = (rows.importBatches as unknown as Models['importBatches'][]).filter(batch => batch.payload != null).map(batch => ({
    id: batch.id, filename: batch.filename ?? 'Lote legado', state: batch.state, createdAt: batch.createdAt.toISOString(), expiresAt: originalExpiresAt(batch).toISOString(), revision: revision(batch),
  }));
  return { revision: dataRevision(rows), counts: counts(rows), retentionDays: IMPORT_ORIGINAL_RETENTION_DAYS, originals, limits: DATA_LIMITS };
}

/** The uploaded file goes away; extracted rows and confirmed entries stay valid. */
export async function discardOriginal(db: Database, ownerId: string, requestId: string, id: string, expected: string) {
  return operation(db, ownerId, requestId, 'discard-original', { id, expected }, async tx => {
    const batch = await owned(tx, 'importBatches', id, ownerId); checkRevision(batch, expected);
    if (batch.payload == null) fail('NO_ORIGINAL', 409, 'Este lote não guarda mais o arquivo original.');
    const next = withoutOriginal(batch, 'O arquivo original foi apagado a seu pedido. Envie-o novamente para analisar.');
    await tx.put('importBatches', next);
    return { id, revision: next.revision! };
  });
}

/**
 * Explicit, irreversible deletion guarded by a typed confirmation and If-Match.
 * Idempotency logs go first in bounded batches; the owned graph (and, for the
 * account scope, login and sessions) is removed in one transaction. A retry
 * after success finds nothing left and succeeds again.
 */
export async function deleteUserData(db: Database, ownerId: string, input: unknown, expected: string) {
  const { scope } = deleteDataSchema.parse(input);
  const before = await db.transaction(tx => ownedData(tx, ownerId));
  const empty = BACKUP_COLLECTIONS.every(c => !before[c].length);
  if (!empty && dataRevision(before) !== expected) fail('REVISION_CONFLICT', 409, 'Seus dados mudaram. Recarregue a página e confirme novamente.');
  for (;;) {
    const logs = await db.owned('operations', ownerId, { limit: 400 });
    if (!logs.length) break;
    await db.transaction(async tx => { await tx.prefetch('operations', logs); for (const row of logs) await tx.erase('operations', row.id, ownerId); });
  }
  const deleted = await db.transaction(async tx => {
    const current = await ownedData(tx, ownerId);
    if (!empty && dataRevision(current) !== expected) fail('REVISION_CONFLICT', 409, 'Seus dados mudaram. Recarregue a página e confirme novamente.');
    const audits = await tx.owned('financialMigrationAudits', ownerId);
    const [logins, sessions] = scope === 'account' ? await Promise.all([tx.query('authAccounts', { where: [{ field: 'userId', value: ownerId }] }), tx.query('authSessions', { where: [{ field: 'userId', value: ownerId }] })]) : [[], []];
    for (const c of BACKUP_COLLECTIONS) await tx.prefetch(c, current[c]);
    for (const c of [...BACKUP_COLLECTIONS].reverse()) for (const row of current[c]) await tx.erase(c, row.id, ownerId);
    for (const row of audits) await tx.erase('financialMigrationAudits', row.id, ownerId);
    for (const row of logins) await tx.erase('authAccounts', row.id, ownerId);
    for (const row of sessions) await tx.erase('authSessions', row.id, ownerId);
    if (scope === 'account') await tx.erase('users', ownerId, ownerId);
    return counts(current);
  });
  return { scope, deleted };
}

export async function exportEntries(db: Database, ownerId: string, input: unknown) {
  const query = entriesExportSchema.parse(input), where: Predicate[] = [];
  if (query.from) where.push({ field: 'purchaseDate', op: 'gte', value: query.from });
  if (query.to) where.push({ field: 'purchaseDate', op: 'lte', value: query.to });
  const [entries, accounts, categories] = await db.transaction(tx => Promise.all([
    tx.owned('transactions', ownerId, { where, order: [{ field: 'purchaseDate', direction: 'asc' }, { field: 'id', direction: 'asc' }] }),
    tx.owned('accounts', ownerId), tx.owned('categories', ownerId),
  ]));
  const account = new Map(accounts.map(row => [row.id, row.name])), category = new Map(categories.map(row => [row.id, row.name]));
  return entriesCsv(entries.map(row => ({ id: row.id, purchaseDate: row.purchaseDate, competenceMonth: row.competenceMonth, description: row.description, amount: row.amount, kind: row.kind, status: row.status,
    account: account.get(row.accountId) ?? '', category: category.get(row.categoryId) ?? '', dueDate: row.dueDate, paidDate: row.paidDate, notes: row.notes ?? null, source: row.source, archived: row.archivedAt != null, transferId: row.transferId ?? null })));
}
