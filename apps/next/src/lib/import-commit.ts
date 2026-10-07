import { randomUUID } from 'node:crypto';
import type { Database, Models } from '@ecofinance/db';
import { IMPORT_LIMITS, importConfirmSchema, importReviewSchema, importSourceSchema } from '@ecofinance/shared';
import { operation, owned, checkRevision, revision, fail } from './finance-operation';
import { touchMonths } from './planning-lock';
import { activeCard, cardReference, invoiceFor, cardEntry, updatedInvoice } from './card-store';
import { importIdentity, sameImportEntry } from './import-store';

async function invoiceChanges(tx: Database, owner: string, rows: Models['transactions'][]) {
  const ids = [...new Set(rows.flatMap(r => r.invoiceId ? [r.invoiceId] : []))];
  return Promise.all(ids.map(async id => {
    const invoice = await owned(tx, 'invoices', id, owner);
    const [card, existing] = await Promise.all([owned(tx, 'cards', invoice.cardId, owner), tx.owned('transactions', owner, { where: [{ field: 'invoiceId', value: id }] })]);
    const merged = new Map(existing.map(row => [row.id, row]));
    for (const row of rows.filter(r => r.invoiceId === id)) merged.set(row.id, row);
    return updatedInvoice(invoice, [...merged.values()], card);
  }));
}
export async function confirmImport(db: Database, owner: string, key: string, id: string, expected: string, input: unknown) {
  importConfirmSchema.parse(input);
  return operation(db, owner, key, 'confirm-import', { id, expected }, async tx => {
    const batch = await owned(tx, 'importBatches', id, owner);
    // A second independently keyed click cannot commit the same batch twice.
    if (batch.state === 'confirmed') return { id, revision: revision(batch), alreadyConfirmed: true };
    checkRevision(batch, expected);
    if (batch.state !== 'review') fail('BATCH_STATE', 409, 'Confirme somente um lote em revisão.');
    const source=importSourceSchema.parse(batch.source);
    const items = await tx.owned('importItems', owner, { where: [{ field: 'batchId', value: id }] });
    const selected = items.filter(row => row.selected && row.resolution !== 'exclude');
    if (!selected.length || selected.length > IMPORT_LIMITS.rows) fail('INVALID_SELECTION', 400, 'Selecione e salve pelo menos uma linha válida.');
    if (new Set(selected.map(r => r.competenceMonth)).size > 6) fail('COMMIT_LIMIT', 422, 'Confirme até seis competências por arquivo. Exporte períodos menores para manter a gravação atômica.');
    const card = batch.cardId ? await activeCard(tx, owner, batch.cardId) : null;
    await cardReference(tx, owner, 'accounts', batch.accountId!);
    const changed: Models['transactions'][] = [], committed: Models['importItems'][] = [], invoices = new Map<string, { row: Models['invoices']; existing: Models['transactions'][] }>();
    const identities = new Set<string>(), now = new Date();
    for (const item of selected) {
      if (item.state !== 'valid') fail('INVALID_SELECTION', 400, 'Revise as linhas inválidas antes de confirmar.');
      importReviewSchema.parse({ description: item.description, amount: item.amount, purchaseDate: item.purchaseDate, competenceMonth: item.competenceMonth, categoryId: item.categoryId, selected: item.selected, resolution: item.resolution, duplicateId: item.duplicateId ?? null });
      await cardReference(tx, owner, 'categories', item.categoryId!);
      const identity = importIdentity(batch, item), targetId = item.resolution === 'link' ? item.duplicateId! : identity;
      if (identities.has(targetId)) fail('DUPLICATE_SELECTION', 409, 'Duas linhas apontam para a mesma identidade. Exclua uma delas antes de confirmar.');
      identities.add(targetId);
      let row = await tx.get('transactions', targetId), created = false;
      if (row) {
        // Repeating a reverted batch restores only our untouched undo archive.
        // A manual archive/edit or an external dependency always remains a conflict.
        if(item.resolution === 'new' && row.archivedAt && row.importUndoBatchId && row.importUndoRevision===revision(row) && !row.importReferences?.length && sameImportEntry({...row,archivedAt:null},item,batch)) {
          row={...row,archivedAt:null,importUndoBatchId:null,importUndoRevision:null,revision:randomUUID(),updatedAt:now};created=true;
          if(card) {
            const invoice=await owned(tx,'invoices',row.invoiceId!,owner);
            const existing=await tx.owned('transactions',owner,{where:[{field:'invoiceId',value:invoice.id}]});
            invoices.set(invoice.competenceMonth.slice(0,7),{row:invoice,existing:existing.filter(e=>e.id!==row!.id)});
          }
        }
        if (row.ownerId !== owner || !sameImportEntry(row, item, batch)) fail('DUPLICATE_CONFLICT', 409, 'A identidade já existe com dados diferentes ou arquivados. Revise o lançamento original; nenhum item foi gravado.');
        if (card && (await owned(tx, 'invoices', row.invoiceId!, owner)).cardId !== card.id) fail('DUPLICATE_CONFLICT', 409, 'O vínculo deve pertencer ao cartão escolhido.');
      } else {
        if (item.resolution === 'link') fail('DUPLICATE_CONFLICT', 409, 'O lançamento escolhido não existe mais. Refaça a revisão.');
        if (card) {
          const month = item.competenceMonth!.slice(0, 7);
          if (!invoices.has(month)) {
            const invoice = await invoiceFor(tx, owner, card, month);
            const existing = await tx.owned('transactions', owner, { where: [{ field: 'invoiceId', value: invoice.id }] });
            invoices.set(month, { row: invoice, existing });
          }
          const invoice = invoices.get(month)!.row;
          row = { ...cardEntry(owner, invoice, batch.accountId!, item.categoryId!, { description: item.description!, amount: item.amount!, purchaseDate: item.purchaseDate!, competenceMonth: month, type: item.amount!.startsWith('-') ? 'purchase' : 'credit' }), id: identity };
        } else row = { id: identity, ownerId: owner, accountId: batch.accountId!, categoryId: item.categoryId!, description: item.description!, amount: item.amount!, kind: item.amount!.startsWith('-') ? 'expense' : 'income', status: 'settled', currency: 'BRL', purchaseDate: item.purchaseDate!, competenceMonth: item.competenceMonth!, paidDate: item.purchaseDate!, dueDate: null, reviewRequired: false, invoiceId: null, installmentId: null, recurrenceOccurrenceId: null, archivedAt: null, date: new Date(item.purchaseDate! + 'T12:00:00Z'), category: 'desconhecido', source, externalId: 'import:' + identity, latitude: null, longitude: null, uberMetadataId: null, notes: null, transferId: null, revision: randomUUID(), createdAt: now, updatedAt: now };
        row = { ...row, source, externalId: 'import:' + identity };
        created = true;
      }
      const references = [...new Set([...(row.importReferences ?? []), id])];
      if (references.length > 100) fail('REFERENCE_LIMIT', 409, 'Este lançamento já tem 100 referências de importação. Revise o histórico antes de adicionar outro lote.');
      row = { ...row, importReferences: references };
      changed.push(row);
      committed.push({ ...item, transactionId: row.id, invoiceId: row.invoiceId, createdTransaction: created, committedRevision: revision(row), state: 'committed', revision: randomUUID(), updatedAt: now });
    }
    // Every query precedes staged writes, including all invoice and undo dependencies.
    const invoiceRows = [...invoices.values()].map(({ row, existing }) => updatedInvoice(row, [...new Map([...existing,...changed.filter(e=>e.invoiceId===row.id)].map(entry=>[entry.id,entry])).values()], card!));
    await touchMonths(tx, owner, selected.map(r => r.competenceMonth!.slice(0, 7)));
    await tx.putMany('invoices', invoiceRows);
    await tx.putMany('transactions', changed);
    await tx.putMany('importItems', committed);
    const result = { ...batch, state: 'confirmed', payload: null, error: null, revision: randomUUID(), updatedAt: now };
    await tx.put('importBatches', result);
    return { id, revision: result.revision, created: committed.filter(r => r.createdTransaction).length, linked: committed.filter(r => !r.createdTransaction).length };
  });
}
export async function undoImport(db: Database, owner: string, key: string, id: string, expected: string, input: unknown) {
  importConfirmSchema.parse(input);
  return operation(db, owner, key, 'undo-import', { id, expected }, async tx => {
    const batch = await owned(tx, 'importBatches', id, owner);
    if (batch.state === 'reverted') return { id, revision: revision(batch), alreadyReverted: true };
    checkRevision(batch, expected);
    if (batch.state !== 'confirmed') fail('BATCH_STATE', 409, 'Somente lotes confirmados podem ser desfeitos.');
    const items = await tx.owned('importItems', owner, { where: [{ field: 'batchId', value: id }, { field: 'state', value: 'committed' }] });
    const now = new Date();
    const outcomes = await Promise.all(items.map(async item => {
      const row = await owned(tx, 'transactions', item.transactionId!, owner);
      const references = (row.importReferences ?? []).filter(ref => ref !== id);
      const [refunds, occurrences] = await Promise.all([
        tx.owned('transactions', owner, { where: [{ field: 'refundOfId', value: row.id }, { field: 'archivedAt', value: null }], limit: 1 }),
        tx.owned('recurrenceOccurrences', owner, { where: [{ field: 'transactionId', value: row.id }], limit: 1 }),
      ]);
      const reason = !item.createdTransaction ? 'Preservado: o lançamento já existia antes deste lote.' : references.length ? 'Preservado: há referências de outras importações.' : revision(row) !== item.committedRevision ? 'Preservado: foi editado depois da importação.' : row.installmentId || row.recurrenceOccurrenceId || row.transferId || row.reconciledIntoId || refunds.length || occurrences.length ? 'Preservado: há vínculos financeiros posteriores.' : null;
      const undoRevision=randomUUID();
      return { row: { ...row, importReferences: references, ...(!reason && !row.archivedAt ? { archivedAt: now, revision: undoRevision,importUndoBatchId:id,importUndoRevision:undoRevision, updatedAt: now } : {}) }, item: { ...item, undoReason: reason ?? 'Lançamento arquivado pelo desfazer.', revision: randomUUID(), updatedAt: now } };
    }));
    const changed = outcomes.map(o => o.row), reverted = outcomes.map(o => o.item);
    const archived = changed.filter(row => reverted.find(item => item.transactionId === row.id)?.undoReason === 'Lançamento arquivado pelo desfazer.');
    const invoices = await invoiceChanges(tx, owner, archived);
    await touchMonths(tx, owner, [...archived.map(r => r.competenceMonth.slice(0, 7)), ...invoices.map(i => i.competenceMonth.slice(0, 7))]);
    await tx.putMany('invoices', invoices); await tx.putMany('transactions', changed); await tx.putMany('importItems', reverted);
    const next = { ...batch, state: 'reverted', revision: randomUUID(), updatedAt: now }; await tx.put('importBatches', next);
    return { id, revision: next.revision, archived: archived.length, preserved: changed.length - archived.length };
  });
}
