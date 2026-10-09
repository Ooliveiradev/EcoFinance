'use client';
import { useEffect, useReducer, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { IMPORT_DOCUMENT_LIMITS, IMPORT_LIMITS, type ImportBatchView } from '@ecofinance/shared';
import type { ImportHistory, ImportsClientProps } from './imports-client';
interface ImportState {
  files: { id: string; file: File }[]; target: string; batches: ImportBatchView[]; history: ImportHistory[];
  historyPage: number; hasMore: boolean; busy: boolean; error: string; message: string; uploadVersion: number;
  dirtyRows: Record<string, string>;
}
type Action = { type: 'patch'; data: Partial<ImportState> } | { type: 'loaded'; batch: ImportBatchView } | { type: 'history'; batches: ImportHistory[]; page: number; hasMore: boolean } | { type: 'dirty'; id: string; revision: string };
function initial(props: ImportsClientProps): ImportState {
  return { files: [], target: '', batches: [], history: props.recentBatches, historyPage: 1, hasMore: props.recentBatches.length === 20, busy: false, error: props.error ?? '', message: '', uploadVersion: 0, dirtyRows: {} };
}
function reducer(state: ImportState, action: Action): ImportState {
  if (action.type === 'patch') return { ...state, ...action.data };
  if (action.type === 'dirty') return { ...state, dirtyRows: { ...state.dirtyRows, [action.id]: action.revision } };
  if (action.type === 'history') {
    const known = new Set(state.history.map(b => b.id));
    return { ...state, history: [...state.history, ...action.batches.filter(b => !known.has(b.id))], historyPage: action.page, hasMore: action.hasMore };
  }
  const batch = action.batch, dirtyRows = { ...state.dirtyRows };
  for (const row of batch.rows) if (dirtyRows[row.id] !== row.revision) delete dirtyRows[row.id];
  return { ...state, dirtyRows, batches: [batch, ...state.batches.filter(b => b.id !== batch.id)], history: [{ id: batch.id, filename: batch.filename, state: batch.state, format: batch.format,createdAt:batch.createdAt }, ...state.history.filter(b => b.id !== batch.id)] };
}
const documentFile = (file: File) => /^(application\/pdf|image\/(png|jpeg|webp))$/.test(file.type) || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
/**
 * Photos above the document limit are reduced in the browser (longest side 2400 px,
 * JPEG), keeping the orientation recorded by the camera. Other files go untouched.
 */
async function fitImage(file: File): Promise<{ file: File; reduced: boolean }> {
  if (file.size <= IMPORT_DOCUMENT_LIMITS.bytes || !/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return { file, reduced: false };
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= IMPORT_DOCUMENT_LIMITS.bytes) return { file: new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }), reduced: true };
  }
  return { file, reduced: false };
}
export function useImports(props: ImportsClientProps) {
  const router = useRouter(), keys = useRef(new Map<string, string>());
  const [state, dispatch] = useReducer(reducer, props, initial);
  const patch = (data: Partial<ImportState>) => dispatch({ type: 'patch', data });
  // Documents are analysed off the request: poll their progress without blocking the screen.
  const processing = state.batches.filter(batch => batch.state === 'processing').map(batch => batch.id).join(',');
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      for (const id of processing.split(',')) void fetch('/api/imports/' + id, { cache: 'no-store' }).then(async response => { if (response.ok) dispatch({ type: 'loaded', batch: await response.json() as ImportBatchView }); }).catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [processing]);
  function requestKey(signature: string) {
    const old = keys.current.get(signature); if (old) return old;
    const key = crypto.randomUUID(); keys.current.set(signature, key); return key;
  }
  async function read(id: string) {
    const response = await fetch('/api/imports/' + id, { cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Não foi possível carregar o lote.');
    const batch = data as ImportBatchView; dispatch({ type: 'loaded', batch }); return batch;
  }
  async function guarded(action: () => Promise<void>) {
    patch({ busy: true, error: '', message: '' });
    try { await action(); } catch (e) { patch({ error: e instanceof Error ? e.message : 'Falha de comunicação. Tente novamente.' }); } finally { patch({ busy: false }); }
  }
  async function mutate(batch: ImportBatchView, action: string, input: unknown = {}, item?: { id: string; revision: string }) {
    const url = '/api/imports/' + batch.id + (item ? '/items/' + item.id : '/' + action), expected = item?.revision ?? batch.revision;
    // The PDF password never enters the retry signature kept in memory.
    const signature = JSON.stringify([url, expected, action === 'process' ? action : input]);
    if(action==='process')dispatch({type:'loaded',batch:{...batch,state:'processing'}});
    const response = await fetch(url, { method: item ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey(signature), 'If-Match': expected }, body: JSON.stringify(input) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Falha ao salvar. Tente novamente com os mesmos dados.');
    await read(action==='repeat'||action==='map'?data.id:batch.id); keys.current.delete(signature);
    if (action === 'undo' || action === 'confirm') router.refresh();
    if (action === 'undo') patch({ message: `Lote revertido: ${data.archived ?? 0} arquivado(s), ${data.preserved ?? 0} preservado(s). Confira os motivos em cada linha.` });
    if (action === 'confirm') patch({ message: 'Lote confirmado. Saldos, faturas e consultas foram atualizados.' });
    if (action === 'repeat') patch({ message: 'Novo lote criado em revisão. Confira as linhas e a seleção antes de confirmar.' });
    if (action === 'map') patch({ message: data.state === 'review' ? 'Mapeamento aplicado. Confira as linhas antes de confirmar.' : 'O mapeamento ainda exige ajustes. Veja o motivo no lote.' });
  }
  async function upload() {
    const fitted = await Promise.all(state.files.map(entry => fitImage(entry.file))), files = fitted.map(entry => entry.file);
    if (!state.target || !files.length || files.length > IMPORT_LIMITS.files || files.some(f => f.size > (documentFile(f) ? IMPORT_DOCUMENT_LIMITS.bytes : IMPORT_LIMITS.bytes))) throw new Error('Escolha um destino e de 1 a 10 arquivos, com até 256 KiB cada (PDF e imagens: até 512 KiB).');
    const form = new FormData(), [type, id] = state.target.split(':');
    form.append(type === 'card' ? 'cardId' : 'accountId', id!); for (const file of files) form.append('files', file);
    const signature = JSON.stringify(['upload', state.target, state.files.map(f => f.id)]);
    const response = await fetch('/api/imports', { method: 'POST', headers: { 'Idempotency-Key': requestKey(signature) }, body: form });
    const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Falha no upload. Tente novamente com os mesmos arquivos.');
    keys.current.delete(signature);
    // One analysis at a time: concurrent analyses of the same owner contend on
    // the same account entries and would fail as interrupted under load.
    let interrupted = false;
    await (data.batches as { id: string }[]).reduce((previous, received) => previous.then(async () => {
      try { const batch = await read(received.id); await mutate(batch, 'process'); } catch { interrupted = true; }
    }), Promise.resolve());
    patch({ files: [], uploadVersion: state.uploadVersion + 1, message: fitted.some(entry => entry.reduced) ? 'Fotos acima de 512 KiB foram reduzidas no navegador antes do envio.' : '' });
    if (interrupted) throw new Error('Algumas análises foram interrompidas. Abra os lotes no histórico e repita a análise; nenhum saldo foi alterado.');
  }
  async function moreHistory() {
    const page = state.historyPage + 1, response = await fetch('/api/imports?page=' + page, { cache: 'no-store' });
    if (!response.ok) throw new Error('Não foi possível carregar o histórico.');
    const data = await response.json(); dispatch({ type: 'history', batches: data.batches, page, hasMore: data.hasMore });
  }
  return { ...state, guarded, mutate, read, upload, moreHistory,
    setFiles: (files: File[]) => patch({ files: files.map(file => ({ id: crypto.randomUUID(), file })) }),
    setTarget: (target: string) => patch({ target }),
    markDirty: (row: { id: string; revision: string }) => dispatch({ type: 'dirty', ...row }),
  };
}
