'use client';
import { useState } from 'react';
import { IMPORT_DOCUMENT_LIMITS, type ImportBatchView } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';

const phases: Record<string, string> = { queued: 'Na fila de análise', reading: 'Lendo o texto do PDF', ocr: 'Reconhecendo texto (OCR)', interpreting: 'Montando as linhas para revisão' };
const kinds: Record<string, string> = { statement: 'extrato', invoice: 'fatura de cartão', receipt: 'comprovante', unknown: 'documento' };

/** Progress of a PDF/image analysis; the batch stays cancellable while it runs. */
export function DocumentProgress({ batch }: { batch: ImportBatchView }) {
  const progress = batch.progress;
  if (batch.state !== 'processing' || !progress) return null;
  const page = progress.pages ? ` · página ${progress.page} de ${progress.pages}` : '';
  return <div role="status" aria-live="polite" className="space-y-1 text-sm">
    <p>{phases[progress.phase] ?? 'Analisando'}{page}. Você pode cancelar o lote a qualquer momento.</p>
    <progress aria-label={'Análise de ' + batch.filename} value={progress.pages ? progress.page : 0} max={progress.pages || 1} className="w-full" />
  </div>;
}
export function DocumentSummary({ batch }: { batch: ImportBatchView }) {
  const document = batch.document;
  if (!document || document.passwordRequired) return null;
  return <p className="text-sm text-muted">
    {kinds[document.kind]} · {document.pages} página(s){document.ocrPages ? ` · ${document.ocrPages} por OCR` : ''}{document.confidence !== null ? ` · menor confiança do OCR ${document.confidence}%` : ''}. Comprovantes e faturas são tratados como documentos distintos; nada é confirmado sem a sua revisão.
  </p>;
}
/** The password goes only to this analysis; the field is cleared after sending. */
export function DocumentPassword({ batch, busy, onSubmit }: { batch: ImportBatchView; busy: boolean; onSubmit: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  if (batch.state !== 'failed' || !batch.document?.passwordRequired) return null;
  return <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); const value = password; setPassword(''); void onSubmit(value); }}>
    <label className="text-sm">Senha do PDF
      <input aria-label={'Senha do PDF ' + batch.filename} type="password" autoComplete="off" required maxLength={IMPORT_DOCUMENT_LIMITS.password} value={password} onChange={event => setPassword(event.target.value)} className="mt-1 block rounded-lg border border-border bg-surface p-2" />
    </label>
    <Button type="submit" disabled={busy || !password}>Analisar com senha</Button>
    <p className="text-xs text-muted w-full">A senha é usada só nesta análise e não é armazenada nem registrada.</p>
  </form>;
}
