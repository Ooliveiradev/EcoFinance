import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { IMPORT_DOCUMENT_LIMITS, type ImportProgress } from '@ecofinance/shared';
import { fail } from './finance-operation';
import { ImportParseError } from './import-errors';
import type { DocumentExtraction } from './import-document';
import type { DocumentType } from './import-document-file';

/**
 * In-process queue for document extraction. The request that starts a job returns
 * immediately; extraction runs in a worker_thread with heap, time and page limits,
 * so OCR never blocks the web event loop. State and progress live in the batch
 * document: any instance can show progress, and a job whose batch was cancelled or
 * re-claimed stops at the next progress checkpoint. Cancellation on this instance
 * terminates the thread at once.
 */
export interface DocumentJob { id: string; type: DocumentType; bytes: Uint8Array; password?: string }
export interface DocumentJobHandlers {
  /** Persist progress; false means the batch no longer belongs to this job. */
  progress: (progress: ImportProgress) => Promise<boolean>;
  complete: (extraction: DocumentExtraction) => Promise<void>;
  failed: (error: ImportParseError) => Promise<void>;
}
interface Running { worker: Worker | null; abort: (error: ImportParseError | null) => void }

const running = new Map<string, Running>(), queue: (() => void)[] = [];
let active = 0;
const settled = new Set<Promise<void>>();
const concurrency = () => Math.max(1, Number(process.env.IMPORT_DOCUMENT_CONCURRENCY) || 1);
const maxQueued = () => Math.max(0, Number(process.env.IMPORT_DOCUMENT_QUEUE ?? 8));
export const ocrEnabled = () => process.env.IMPORT_OCR === 'on';
export const documentTimeout = () => Math.max(1000, Number(process.env.IMPORT_DOCUMENT_TIMEOUT_MS) || IMPORT_DOCUMENT_LIMITS.timeoutMs);

function workerPath() {
  const candidates = [process.env.IMPORT_DOCUMENT_WORKER, join(process.cwd(), 'workers', 'document-extract.mjs'), join(process.cwd(), 'apps', 'next', 'workers', 'document-extract.mjs')];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) fail('DOCUMENTS_UNAVAILABLE', 503, 'A leitura de PDF e imagens não está instalada neste servidor. Exporte OFX/CSV.');
  return found!;
}
/** Rejects before claiming the batch when this instance cannot take more work. */
export function assertDocumentCapacity() {
  workerPath();
  if (queue.length >= maxQueued()) fail('DOCUMENT_QUEUE_FULL', 503, 'Muitos documentos em análise. Aguarde alguns instantes e tente novamente.');
}
export function abortDocumentJob(id: string) { running.get(id)?.abort(null); }
/** Resolves when every queued or running job has settled (tests and graceful shutdown). */
export async function documentJobsIdle() { while (settled.size) await Promise.allSettled([...settled]); }

export function startDocumentJob(job: DocumentJob, handlers: DocumentJobHandlers) {
  running.get(job.id)?.abort(null);
  let cancelled = false, release: () => void = () => {};
  const entry: Running = { worker: null, abort: () => { cancelled = true; entry.worker?.terminate().catch(() => {}); release(); } };
  running.set(job.id, entry);
  const done = new Promise<void>(resolve => {
    const begin = () => {
      if (cancelled) { resolve(); return; }
      active++;
      const finish = () => { if (running.get(job.id) === entry) running.delete(job.id); active--; queue.shift()?.(); resolve(); };
      void run(job, handlers, entry, () => cancelled).finally(finish);
    };
    release = () => { const index = queue.indexOf(begin); if (index >= 0) { queue.splice(index, 1); running.delete(job.id); resolve(); } };
    if (active < concurrency()) begin(); else queue.push(begin);
  });
  settled.add(done);
  void done.finally(() => settled.delete(done));
  return done;
}
async function run(job: DocumentJob, handlers: DocumentJobHandlers, entry: Running, cancelled: () => boolean) {
  let last = 0, checking: Promise<boolean> = Promise.resolve(true);
  const outcome = await new Promise<{ extraction?: DocumentExtraction; error?: ImportParseError; stop?: boolean }>(resolve => {
    let finished = false;
    const end = (value: { extraction?: DocumentExtraction; error?: ImportParseError; stop?: boolean }) => { if (finished) return; finished = true; clearTimeout(timer); void worker.terminate().catch(() => {}); resolve(value); };
    const worker = new Worker(workerPath(), {
      workerData: { bytes: job.bytes, type: job.type, password: job.password ?? null, ocr: ocrEnabled(), limits: IMPORT_DOCUMENT_LIMITS },
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64 }, stdout: true, stderr: true,
    });
    entry.worker = worker;
    entry.abort = error => { if (error) end({ error }); else end({ stop: true }); };
    const timer = setTimeout(() => end({ error: new ImportParseError('TIMEOUT', `A análise excedeu ${Math.round(documentTimeout() / 1000)} s e foi interrompida. Envie menos páginas ou o PDF original do banco.`, job.type.toUpperCase()) }), documentTimeout());
    worker.on('message', (message: { type: string; phase?: ImportProgress['phase']; page?: number; pages?: number; extraction?: DocumentExtraction; code?: string; message?: string }) => {
      if (message.type === 'progress') {
        const now = Date.now();
        // Checkpoints are throttled; each one also verifies the batch is still ours.
        if (now - last < 750 && message.phase === 'reading') return;
        last = now;
        checking = checking.then(ok => ok && handlers.progress({ phase: message.phase!, page: message.page!, pages: message.pages!, updatedAt: new Date().toISOString() })).catch(() => true);
        void checking.then(ok => { if (!ok) end({ stop: true }); });
      } else if (message.type === 'result') end({ extraction: message.extraction! });
      else if (message.type === 'error') end({ error: new ImportParseError(message.code ?? 'EXTRACTION_FAILED', message.message ?? 'Não foi possível ler o documento.', job.type.toUpperCase()) });
    });
    worker.on('error', error => end({ error: new ImportParseError((error as { code?: string }).code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORY_LIMIT' : 'EXTRACTION_FAILED', (error as { code?: string }).code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'O documento excedeu o limite de memória da análise. Envie menos páginas ou resolução menor.' : 'A leitura do documento falhou. Tente novamente ou exporte OFX/CSV.', job.type.toUpperCase()) }));
    worker.on('exit', () => end({ error: new ImportParseError('EXTRACTION_FAILED', 'A leitura do documento foi interrompida. Tente novamente.', job.type.toUpperCase()) }));
    // Worker output is discarded: library logs could echo document content.
    worker.stdout?.resume(); worker.stderr?.resume();
  });
  if (outcome.stop || cancelled() || !(await checking)) return;
  if (outcome.extraction) await handlers.complete(outcome.extraction);
  else await handlers.failed(outcome.error!);
}
