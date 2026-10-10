import { randomUUID, createHash } from 'node:crypto';
import type { Database, Models } from '@ecofinance/db';
import { IMPORT_LIMITS, IMPORT_MAPPING_LIMITS, importMapRequestSchema, importProcessSchema, importReviewSchema, importPreview, importTargetSchema, type ImportBatchView, type ImportLayout, type ImportMapping, type ImportProgress, type ImportRowView } from '@ecofinance/shared';
import { operation, owned, checkRevision, revision, fail, FinanceError } from './finance-operation';
import { stableId } from './planning-lock';
import { activeCard, cardReference } from './card-store';
import { ImportParseError, type ImportFile } from './import-parsers';
import { parseImportFile } from './import-document';

export function importIdentity(batch: Models['importBatches'], item: Models['importItems']) {
  const scope = batch.cardId ? ['card', batch.cardId] : ['account', batch.accountId];
  return stableId(['import-entry', batch.ownerId, scope, item.externalId ? [batch.source, item.externalId] : ['file', batch.fileHash, item.position]]);
}
export function sameImportEntry(row: Models['transactions'], item: Models['importItems'], batch: Models['importBatches']) {
  const negative = item.amount?.startsWith('-'), kind = negative ? 'expense' : batch.cardId ? 'refund' : 'income';
  return !row.archivedAt && row.kind === kind && row.status === (batch.cardId ? 'recorded' : 'settled') && row.amount === item.amount && row.purchaseDate === item.purchaseDate && row.competenceMonth === item.competenceMonth && row.categoryId === item.categoryId && row.description === item.description && row.accountId === batch.accountId && (batch.cardId ? !!row.invoiceId && row.cardEntryType === (negative ? 'purchase' : 'credit') : !row.invoiceId && row.paidDate === item.purchaseDate);
}
export async function receiveImports(db: Database, owner: string, key: string, files: ImportFile[], target: { accountId: string | null; cardId: string | null }) {
  if (!files.length || files.length > IMPORT_LIMITS.files) fail('FILE_COUNT', 400, 'Selecione de 1 a 10 arquivos.');
  if (!!target.accountId === !!target.cardId) fail('INVALID_TARGET', 400, 'Escolha uma conta ou cartão de destino.');
  importTargetSchema.parse(target);
  if (files.some(file => file.bytes.length > IMPORT_LIMITS.bytes)) fail('FILE_LIMIT', 413, 'Cada arquivo deve ter até 256 KiB. Exporte um período menor.');
  const fingerprints = files.map(file => ({ name: file.name.slice(0, 200), mime: file.mime.slice(0, 120), digest: createHash('sha256').update(file.bytes).digest('hex') }));
  return operation(db, owner, key, 'receive-imports', { target, fingerprints }, async tx => {
    let accountId = target.accountId;
    if (target.cardId) accountId = (await activeCard(tx, owner, target.cardId)).paymentAccountId;
    await cardReference(tx, owner, 'accounts', accountId!);
    const now = new Date();
    const batches: Models['importBatches'][] = files.map((file, i) => ({
      id: randomUUID(), ownerId: owner, accountId, cardId: target.cardId, source: 'document', state: 'received',
      idempotencyKey: `${key}:${i}`, fileHash: fingerprints[i]!.digest, storageKey: null, expiresAt: null,
      filename: fingerprints[i]!.name, mime: fingerprints[i]!.mime, payload: Buffer.from(file.bytes).toString('base64'),
      format: 'A identificar', error: null, processId: null, revision: randomUUID(), createdAt: now, updatedAt: now,
    }));
    await tx.putMany('importBatches', batches);
    return { batches: batches.map(b => ({ id: b.id, revision: b.revision })) };
  });
}
interface StoredProfile { mapping: ImportMapping; kind: ImportLayout['kind']; updatedAt: string }
/** Saved mappings live in the owner's single preferences document, keyed by layout fingerprint. */
async function preferencesOf(tx: Database, owner: string) {
  return (await tx.owned('preferences', owner, { limit: 1 }))[0] ?? null;
}
export async function importProfiles(db: Database, owner: string): Promise<Record<string, ImportMapping>> {
  const stored = ((await preferencesOf(db, owner))?.settings.importProfiles ?? {}) as Record<string, StoredProfile>;
  return Object.fromEntries(Object.entries(stored).map(([fingerprint, profile]) => [fingerprint, profile.mapping]));
}
async function saveProfile(tx: Database, owner: string, fingerprint: string, kind: ImportLayout['kind'], mapping: ImportMapping) {
  const now = new Date(), current = await preferencesOf(tx, owner);
  const profiles = { ...(current?.settings.importProfiles ?? {}) as Record<string, StoredProfile>, [fingerprint]: { mapping, kind, updatedAt: now.toISOString() } };
  const kept = Object.entries(profiles).sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, IMPORT_MAPPING_LIMITS.profiles);
  await tx.put('preferences', { id: current?.id ?? stableId(['preferences', owner]), ownerId: owner, settings: { ...current?.settings, importProfiles: Object.fromEntries(kept) }, createdAt: current?.createdAt ?? now, updatedAt: now });
}
/**
 * Apply a user-confirmed column mapping. A failed analysis is retried in place;
 * a batch already in review is cancelled and replaced so earlier rows stay auditable.
 */
export async function mapImport(db: Database, owner: string, key: string, id: string, expected: string, input: unknown) {
  const { mapping, remember } = importMapRequestSchema.parse(input);
  const result = await operation(db, owner, key, 'map-import', { id, expected, mapping, remember }, async tx => {
    const batch = await owned(tx, 'importBatches', id, owner); checkRevision(batch, expected);
    const layout = batch.layout;
    if (!layout || !['failed', 'review'].includes(batch.state)) fail('BATCH_STATE', 409, 'Somente CSV/TSV ou planilhas em revisão ou com falha aceitam mapeamento de colunas.');
    if (batch.payload == null) fail('EMPTY_REPEAT', 422, 'O arquivo original não está mais em staging. Selecione o arquivo e faça um novo upload.');
    const sheet = layout!.kind === 'spreadsheet' ? layout!.sheets.find(s => s.name === (mapping.sheet ?? (layout!.sheets.length === 1 ? layout!.sheets[0]!.name : ''))) : layout!.sheets[0];
    if (!sheet) fail('INVALID_MAPPING', 400, 'Escolha uma aba existente da planilha.');
    if ([mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit].some(column => column !== null && column >= sheet!.columns)) fail('INVALID_MAPPING', 400, 'O mapeamento indica colunas inexistentes no arquivo.');
    const confirmed = { ...mapping, sheet: layout!.kind === 'spreadsheet' ? sheet!.name : null };
    if (remember) await saveProfile(tx, owner, sheet!.fingerprint, layout!.kind, confirmed);
    const now = new Date();
    if (batch.state === 'failed') {
      const next = { ...batch, mapping: confirmed, state: 'received', error: null, processId: null, revision: randomUUID(), updatedAt: now };
      await tx.put('importBatches', next); return { id, revision: next.revision };
    }
    const next = { ...batch, id: randomUUID(), idempotencyKey: key, mapping: confirmed, state: 'received', error: null, processId: null, revision: randomUUID(), createdAt: now, updatedAt: now };
    await tx.put('importBatches', { ...batch, state: 'cancelled', payload: null, processId: null, revision: randomUUID(), updatedAt: now });
    await tx.put('importBatches', next, true);
    return { id: next.id, revision: next.revision };
  });
  const target = String(result.id), current = await db.get('importBatches', target);
  return current?.state === 'received' && current.revision === result.revision ? processImport(db, owner, target, String(result.revision)) : loadImport(db, owner, target);
}
/**
 * Document extraction reports pages while it runs. Progress is informational: it
 * does not change the batch revision, so a cancellation sent with the revision the
 * user sees still applies. Cancellation or a newer analysis stops the worker.
 */
function watchAnalysis(db: Database, owner: string, id: string, token: string) {
  const controller = new AbortController();
  let pending = Promise.resolve();
  const step = (progress: ImportProgress | null) => { pending = pending.then(() => db.transaction(async tx => {
    const current = await owned(tx, 'importBatches', id, owner);
    if (current.state !== 'processing' || current.processId !== token) { controller.abort(); return; }
    if (progress) await tx.put('importBatches', { ...current, progress });
  })).catch(() => {}); };
  const timer = setInterval(() => step(null), 2000);
  return { signal: controller.signal, onProgress: (progress: ImportProgress) => step(progress), stop: async () => { clearInterval(timer); await pending; } };
}
export async function processImport(db: Database, owner: string, id: string, expected: string, input: unknown = {}) {
  // The password reaches only the extraction worker: it is not persisted, logged or returned.
  const { password } = importProcessSchema.parse(input ?? {});
  const token = randomUUID();
  const batch = await db.transaction(async tx => {
    const old = await owned(tx, 'importBatches', id, owner); checkRevision(old, expected);
    if (!['received', 'processing', 'failed'].includes(old.state) || old.payload == null) fail('BATCH_STATE', 409, 'Este lote não pode ser analisado novamente.');
    const next = { ...old, state: 'processing', processId: token, error: null, errorCode: null, progress: null, revision: randomUUID(), updatedAt: new Date() };
    await tx.put('importBatches', next); return next;
  });
  const watch = watchAnalysis(db, owner, id, token);
  try {
    let parsed;
    try { parsed = await parseImportFile({ name: batch.filename!, mime: batch.mime!, bytes: Buffer.from(batch.payload!, 'base64') }, { mapping: batch.mapping ?? null, profiles: await importProfiles(db, owner), password, signal: watch.signal, onProgress: watch.onProgress }); }
    finally { await watch.stop(); }
    const target = parsed.documentKind === 'invoice' && !batch.cardId ? ['O documento parece uma fatura de cartão, mas o destino é uma conta. Confira o destino antes de confirmar.']
      : parsed.documentKind === 'statement' && batch.cardId ? ['O documento parece um extrato de conta, mas o destino é um cartão. Confira o destino antes de confirmar.'] : [];
    parsed.warnings.push(...target);
    await db.transaction(async tx => {
      const current = await owned(tx, 'importBatches', id, owner);
      if (current.state !== 'processing' || current.processId !== token) fail('BATCH_STATE', 409, 'A análise foi cancelada ou substituída. Recarregue o lote.');
      const accountEntries = await tx.owned('transactions', owner, { where: [{ field: 'accountId', value: batch.accountId }] });
      const invoiceCards = batch.cardId ? new Set((await tx.owned('invoices', owner, { where: [{ field: 'cardId', value: batch.cardId }] })).map(i => i.id)) : null;
      const rows: Models['importItems'][] = parsed.rows.map((row, i) => {
        const valid = !!row.amount && !!row.purchaseDate && !!row.description, now = new Date();
        const item: Models['importItems'] = { ...row, id: stableId(['import-item', id, i + 1]), ownerId: owner, batchId: id, position: i + 1,
          accountId: batch.accountId, categoryId: null, invoiceId: null, transactionId: null, currency: 'BRL',
          kind: row.amount?.startsWith('-') ? 'expense' : batch.cardId ? 'refund' : 'income',
          competenceMonth: row.purchaseDate ? row.purchaseDate.slice(0, 7) + '-01' : null,
          warnings: [...parsed.warnings, ...row.warnings], state: valid ? 'pending' : 'invalid', selected: false,
          resolution: 'new', duplicateId: null, revision: randomUUID(), createdAt: now, updatedAt: now };
        const identity = importIdentity({...batch,source:parsed.source}, item);
        item.candidates = accountEntries.filter(e => !e.archivedAt && (invoiceCards ? !!e.invoiceId && invoiceCards.has(e.invoiceId) : !e.invoiceId) && (e.id === identity || e.amount === item.amount && e.purchaseDate === item.purchaseDate && e.description.trim().toLowerCase() === item.description?.trim().toLowerCase())).slice(0, 20).map(e => ({ id: e.id, description: e.description, amount: e.amount, purchaseDate: e.purchaseDate, categoryId:e.categoryId,competenceMonth:e.competenceMonth,status:e.status,exact: e.id === identity }));
        if (item.candidates.length) item.warnings.push('Possível duplicata: revise e escolha criar, vincular ou excluir.');
        if (valid) item.warnings.push('Escolha a categoria e confirme os dados da linha.');
        return item;
      });
      await tx.putMany('importItems', rows);
      await tx.put('importBatches', { ...current, source: parsed.source, format: parsed.format, accountHint: parsed.accountHint, layout: parsed.layout ?? null, state: 'review', processId: null, progress: null, revision: randomUUID(), updatedAt: new Date() });
    });
  } catch (error) {
    // Persist the actionable parser diagnostic, but never overwrite cancellation/newer work.
    await db.transaction(async tx => {
      const current = await owned(tx, 'importBatches', id, owner);
      if (current.state !== 'processing' || current.processId !== token) return;
      await tx.put('importBatches', { ...current, state: 'failed', format:error instanceof ImportParseError?error.format:current.format, layout: error instanceof ImportParseError ? error.layout : null,error: error instanceof FinanceError ? error.message : 'Análise interrompida. Repita com os mesmos arquivos; nenhum lançamento foi criado.', errorCode: error instanceof FinanceError ? error.code : 'INTERRUPTED', processId: null, progress: null, revision: randomUUID(), updatedAt: new Date() });
    });
  }
  return loadImport(db, owner, id);
}
export async function reviewImportItem(db: Database, owner: string, key: string, batchId: string, id: string, expected: string, input: unknown) {
  const data = importReviewSchema.parse(input);
  return operation(db, owner, key, 'review-import', { batchId, id, expected, data }, async tx => {
    const batch = await owned(tx, 'importBatches', batchId, owner);
    if (batch.state !== 'review') fail('BATCH_STATE', 409, 'A revisão está encerrada.');
    const item = await owned(tx, 'importItems', id, owner); if (item.batchId !== batchId) fail('NOT_FOUND', 404, 'Linha não encontrada.'); checkRevision(item, expected);
    await cardReference(tx, owner, 'categories', data.categoryId);
    if (data.resolution === 'link') {
      const existing = await owned(tx, 'transactions', data.duplicateId!, owner);
      if (!sameImportEntry(existing, { ...item, ...data }, batch)) fail('DUPLICATE_CONFLICT', 409, 'O lançamento existente não corresponde a valor, data, descrição, competência, categoria e destino.');
      if (batch.cardId && (await owned(tx, 'invoices', existing.invoiceId!, owner)).cardId !== batch.cardId) fail('DUPLICATE_CONFLICT', 409, 'Escolha um lançamento deste cartão.');
    }
    const next = { ...item, ...data, duplicateId: data.resolution === 'link' ? data.duplicateId : null, kind: data.amount.startsWith('-') ? 'expense' : batch.cardId ? 'refund' : 'income', state: data.resolution === 'exclude' ? 'excluded' : 'valid', revision: randomUUID(), updatedAt: new Date() };
    const nextBatch = { ...batch, revision: randomUUID(), updatedAt: new Date() };
    // Staging is ordered: the item is persisted before its parent revision changes.
    await tx.put('importItems', next).then(() => tx.put('importBatches', nextBatch));
    return { id, revision: next.revision, batchRevision: nextBatch.revision };
  });
}
export async function cancelImport(db: Database, owner: string, key: string, id: string, expected: string) {
  return operation(db, owner, key, 'cancel-import', { id, expected }, async tx => {
    const batch = await owned(tx, 'importBatches', id, owner); checkRevision(batch, expected);
    if (!['received', 'processing', 'review', 'failed'].includes(batch.state)) fail('BATCH_STATE', 409, 'Só lotes ainda não confirmados podem ser cancelados.');
    const row = { ...batch, state: 'cancelled', payload: null, processId: null, progress: null, revision: randomUUID(), updatedAt: new Date() };
    await tx.put('importBatches', row); return { id, revision: row.revision };
  });
}
export async function repeatImport(db:Database,owner:string,key:string,id:string,expected:string) {
  return operation(db,owner,key,'repeat-import',{id,expected},async tx=>{
    const batch=await owned(tx,'importBatches',id,owner);checkRevision(batch,expected);
    if(!['cancelled','confirmed','reverted','review'].includes(batch.state))fail('BATCH_STATE',409,'Aguarde a análise ou use repetir análise para arquivos com falha.');
    const items=await tx.owned('importItems',owner,{where:[{field:'batchId',value:id}],order:[{field:'position',direction:'asc'}]});
    if(!items.length || !batch.fileHash)fail('EMPTY_REPEAT',422,'Este lote não tem linhas analisadas. Selecione o arquivo e faça um novo upload.');
    await cardReference(tx,owner,'accounts',batch.accountId!);if(batch.cardId)await activeCard(tx,owner,batch.cardId);
    const now=new Date(),newId=randomUUID();
    const next={...batch,id:newId,state:'review',idempotencyKey:key,payload:null,processId:null,error:null,revision:randomUUID(),createdAt:now,updatedAt:now};
    const copies=items.map(item=>({...item,id:stableId(['import-item',newId,item.position]),batchId:newId,selected:false,resolution:'new' as const,duplicateId:null,candidates:[],transactionId:null,invoiceId:null,createdTransaction:false,committedRevision:null,undoReason:null,state:item.description && item.amount && item.purchaseDate?'pending':'invalid',revision:randomUUID(),createdAt:now,updatedAt:now}));
    await tx.put('importBatches',next,true);await tx.putMany('importItems',copies);
    return {id:newId,revision:next.revision};
  });
}
export async function loadImport(db: Database, owner: string, id: string): Promise<ImportBatchView> {
  return db.transaction(async tx => {
    const [batch, items] = await Promise.all([
      owned(tx, 'importBatches', id, owner),
      tx.owned('importItems', owner, { where: [{ field: 'batchId', value: id }], order: [{ field: 'position', direction: 'asc' }] }),
    ]);
    const rows: ImportRowView[] = items.map(item => ({ id: item.id, position: item.position, state: item.state, revision: revision(item), description: item.description, amount: item.amount, purchaseDate: item.purchaseDate, competenceMonth: item.competenceMonth, categoryId: item.categoryId, selected: item.selected ?? false, resolution: item.resolution ?? 'new', duplicateId: item.duplicateId ?? null, warnings: item.warnings, provenance: item.provenance, candidates: item.candidates ?? [], undoReason: item.undoReason ?? null }));
    // The preview rechecks deterministic identities so a concurrent import cannot
    // keep showing an additional expense after another batch has committed it.
    const existing = batch.state === 'review' ? await Promise.all(items.map(item => tx.get('transactions', importIdentity(batch,item)))) : [];
    for (const [index, entry] of existing.entries()) if(entry) {
      rows[index]!.candidates=rows[index]!.candidates.filter(c=>c.id!==entry.id);
      rows[index]!.candidates.push({id:entry.id,description:entry.description,amount:entry.amount,purchaseDate:entry.purchaseDate,categoryId:entry.categoryId,competenceMonth:entry.competenceMonth,status:entry.status,archived:!!entry.archivedAt,exact:true});
    }
    const dates = rows.flatMap(r => r.purchaseDate ? [r.purchaseDate] : []).sort();
    return { id, filename: batch.filename ?? 'Lote legado', format: batch.format ?? batch.source, state: batch.state, revision: revision(batch), error: batch.error ?? null, errorCode: batch.errorCode ?? null, progress: batch.state === 'processing' ? batch.progress ?? null : null, accountId: batch.accountId, cardId: batch.cardId, period: dates.length ? `${dates[0]} — ${dates.at(-1)}` : null, createdAt: batch.createdAt.toISOString(), layout: batch.layout ?? null, mapping: batch.mapping ?? null, rows, preview: importPreview(rows.map(r => ({ ...r, resolution: r.candidates.some(c => c.exact && !c.archived) ? 'link' : r.resolution })), !!batch.cardId) };
  });
}
