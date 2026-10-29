import { createHash, randomUUID } from 'node:crypto';
import type { Database, Models } from '@ecofinance/db';
import { IGNORED_CAPTURE, CAPTURE_PARSER, captureRow, captureSourcesSchema, captureUploadSchema, parseCapture, type CaptureSource, type ParsedImportRow } from '@ecofinance/shared';
import { operation } from './finance-operation';
import { stableId } from './planning-lock';
import { activeCard, cardReference } from './card-store';
import { stageItems } from './import-store';
import { suggestImportCategories } from './category-rules';

/**
 * Optional expense capture (#19). The user chooses which Android apps are read and
 * the account or card of each one; the bank name in a notice never picks a target.
 * Each eligible notice becomes a row of an import batch in review, so totals only
 * change after the same confirmation used by file imports.
 */
async function preferencesOf(tx: Database, owner: string) {
  return (await tx.owned('preferences', owner, { limit: 1 }))[0] ?? null;
}
export async function captureSources(db: Database, owner: string): Promise<CaptureSource[]> {
  return ((await preferencesOf(db, owner))?.settings.captureSources ?? []) as CaptureSource[];
}
async function checkTarget(tx: Database, owner: string, source: CaptureSource) {
  if (source.cardId) await activeCard(tx, owner, source.cardId);
  else await cardReference(tx, owner, 'accounts', source.accountId!);
}
/** Replaces the list of enabled apps; an empty list pauses capture on the server for every device. */
export async function saveCaptureSources(db: Database, owner: string, key: string, input: unknown) {
  const { sources } = captureSourcesSchema.parse(input);
  return operation(db, owner, key, 'capture-sources', { sources }, async tx => {
    await Promise.all(sources.map(source => checkTarget(tx, owner, source)));
    const now = new Date(), current = await preferencesOf(tx, owner);
    await tx.put('preferences', { id: current?.id ?? stableId(['preferences', owner]), ownerId: owner, settings: { ...current?.settings, captureSources: sources }, createdAt: current?.createdAt ?? now, updatedAt: now });
    return { sources };
  });
}
/** Identity of a notice: owner, device, app, notification key and post time (Android reuses keys). */
export const captureEventId = (owner: string, deviceId: string, event: { package: string; key: string; postedAt: string }) =>
  stableId(['capture-event', owner, deviceId, event.package, event.key, new Date(event.postedAt).toISOString()]);

/**
 * Receives notices from one device. Repeated notices (retries, replays after a
 * restart) are skipped by identity; notices from apps the user did not enable,
 * declined purchases, bill payments, codes and non-financial notices are dropped
 * before anything is stored. Accepted notices become one review batch per target.
 */
export async function receiveCaptures(db: Database, owner: string, key: string, input: unknown) {
  const { deviceId, events } = captureUploadSchema.parse(input);
  const ids = events.map(event => captureEventId(owner, deviceId, event));
  const result = await operation(db, owner, key, 'receive-captures', { deviceId, ids }, async tx => {
    const sources = new Map((await captureSources(tx, owner)).map(source => [source.package, source]));
    const ignored: Record<string, number> = {}, groups = new Map<string, { source: CaptureSource; rows: ParsedImportRow[] }>();
    const skip = (reason: string) => { ignored[reason] = (ignored[reason] ?? 0) + 1; };
    // One identity lookup per notice of an enabled app, all before any write.
    const stored = await Promise.all(events.map((event, index) => sources.has(event.package)
      ? tx.owned('importItems', owner, { where: [{ field: 'externalId', value: ids[index]! }], limit: 1 }).then(rows => rows.length > 0) : false));
    let repeated = 0;
    for (const [index, event] of events.entries()) {
      const source = sources.get(event.package);
      if (!source) { skip('app não habilitado'); continue; }
      const id = ids[index]!;
      if (ids.indexOf(id) !== index || stored[index]) { repeated++; continue; }
      const parsed = parseCapture(event), row = captureRow(event, parsed, id);
      if (!row) { skip(IGNORED_CAPTURE[parsed.kind]!); continue; }
      const target = source.cardId ? 'card:' + source.cardId : 'account:' + source.accountId;
      if (!groups.has(target)) groups.set(target, { source, rows: [] });
      groups.get(target)!.rows.push(row);
    }
    const staged = await Promise.all([...groups].map(async ([target, { source, rows }]) => {
      await checkTarget(tx, owner, source);
      const accountId = source.cardId ? (await activeCard(tx, owner, source.cardId)).paymentAccountId : source.accountId;
      const now = new Date(), digest = createHash('sha256').update(rows.map(row => row.externalId).join('\n')).digest('hex');
      const batch: Models['importBatches'] = {
        id: stableId(['capture-batch', owner, key, target]), ownerId: owner, accountId, cardId: source.cardId, source: 'notification', state: 'review',
        idempotencyKey: `${key}:${target}`, fileHash: digest, storageKey: null, expiresAt: null, payload: null,
        filename: `Notificações de ${source.label} — ${now.toISOString().slice(0, 10)}`.slice(0, 200), mime: 'application/x-ecofinance-capture',
        format: `Notificação Android (${CAPTURE_PARSER})`, error: null, processId: null, layout: null, mapping: null, revision: randomUUID(), createdAt: now, updatedAt: now,
      };
      // Reads (rules, duplicates) happen before any write in the transaction.
      const assist = await suggestImportCategories(tx, owner, rows.map((row, i) => ({ position: i + 1, description: row.description, amount: row.amount })), null);
      return { batch, items: await stageItems(tx, owner, batch, rows, [], assist.suggestions) };
    }));
    await Promise.all(staged.map(({ batch }) => tx.put('importBatches', batch, true)));
    const items = staged.flatMap(group => group.items);
    if (items.length) await tx.putMany('importItems', items);
    return { batches: staged.map(({ batch }) => ({ id: batch.id, revision: batch.revision! })), accepted: items.length, repeated, ignored };
  });
  return result;
}
