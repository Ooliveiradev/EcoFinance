import { useRef, useState } from 'react';
import type { ImportBatchView, ImportRowView } from '@ecofinance/shared';
import { batchAction, hasPendingReview, intentKey, pendingReview, reviewFormBody, reviewItem, type BatchAction, type ReviewDraft, type ReviewForm } from '../data/imports';
import { NO_NOTICE, type NoticeState } from '../data/outcome';

const DONE: Record<BatchAction, string> = { confirm: 'Importação confirmada. Os lançamentos já aparecem no mês.', undo: 'Importação desfeita.', cancel: 'Lote cancelado.' };
/** Drafts survive refreshes and failed requests. Their original revision is never silently rebased. */
export function useImportReview(batchId: string, reload: () => void, failure: (raw: unknown) => NoticeState) {
  const [notice, setNotice] = useState<NoticeState>(NO_NOTICE);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const sending = useRef(false);
  const keys = useRef(new Map<string, string>());
  function change(row: ImportRowView, form: ReviewForm) {
    if (sending.current) return;
    setDrafts(current => ({ ...current, [row.id]: { base: pendingReview(current[row.id], row)?.base ?? row, form, saved: false, errors: {} } }));
  }
  function discard(row: ImportRowView) {
    if (sending.current) return;
    setDrafts(current => { const next = { ...current }; delete next[row.id]; return next; });
  }
  async function review(row: ImportRowView) {
    const draft = pendingReview(drafts[row.id], row);
    if (sending.current || !draft || draft.saved || draft.base.revision !== row.revision) return;
    const built = reviewFormBody(draft.base, draft.form);
    if (!built.ok) { setDrafts(current => ({ ...current, [row.id]: { ...draft, errors: built.errors } })); return; }
    sending.current = true; setBusy(true);
    try {
      await reviewItem(batchId, draft.base, built.body, intentKey(keys.current, JSON.stringify(['review', row.id, draft.base.revision, built.body])));
      setDrafts(current => ({ ...current, [row.id]: { ...draft, saved: true, errors: {} } }));
      setNotice({ message: `Linha ${row.position} salva. Confira a prévia atualizada.`, tone: 'ok' });
    } catch (raw) { setNotice(failure(raw)); }
    finally { sending.current = false; setBusy(false); reload(); }
  }
  function dirty(view: ImportBatchView) {
    return hasPendingReview(drafts, view.rows);
  }
  async function act(view: ImportBatchView, action: BatchAction) {
    if (sending.current || dirty(view)) return;
    sending.current = true; setBusy(true);
    try {
      await batchAction(view, action, intentKey(keys.current, `${action}:${view.revision}`));
      setNotice({ message: DONE[action], tone: 'ok' });
    } catch (raw) { setNotice(failure(raw)); }
    finally { sending.current = false; setBusy(false); reload(); }
  }
  return { notice, busy, drafts, dirty, change, discard, review, act };
}
