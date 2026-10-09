import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { centsToMoney, moneyToCents, type ImportProgress } from '@ecofinance/shared';
import { checkDocument, detectDocument } from './import-document-file';
import { interpretDocument, type DocumentExtraction } from './import-document';
import { abortDocumentJob, documentJobsIdle, startDocumentJob } from './import-jobs';
import { ImportParseError } from './import-errors';
import { documentBytes, documentCorpus, DOCUMENT_PASSWORD } from '../../../../tests/fixtures/documents/corpus';

/** Runs the real worker (pdf.js, canvas, tesseract.js) the way the import store does. */
async function analyse(file: string, target: 'account' | 'card', password?: string, onProgress?: (progress: ImportProgress) => boolean) {
  const bytes = await documentBytes(file), progress: ImportProgress[] = [];
  const document = detectDocument(bytes);
  if (!document) throw new Error('not a document');
  checkDocument(bytes, document);
  let outcome: { extraction?: DocumentExtraction; error?: ImportParseError } = {};
  await startDocumentJob({ id: file, type: document.type, bytes, password }, {
    progress: async value => { progress.push(value); return onProgress ? onProgress(value) : true; },
    complete: async extraction => { outcome = { extraction }; },
    failed: async error => { outcome = { error }; },
  });
  if (outcome.error) throw outcome.error;
  return { result: outcome.extraction ? interpretDocument(outcome.extraction, { target }) : null, progress };
}
async function failure(run: () => Promise<unknown>) {
  try { await run(); } catch (error) { if (error instanceof ImportParseError) return error; throw error; }
  throw new Error('expected a document diagnostic');
}
const env = { ...process.env };
beforeEach(() => { process.env.IMPORT_OCR = 'on'; });
afterEach(async () => { await documentJobsIdle(); process.env = { ...env }; });

describe('synthetic document corpus', () => {
  it.each(documentCorpus.map(entry => [entry.file, entry] as const))('%s matches its hand-written expectation', async (_name, entry) => {
    if (entry.error) {
      const error = await failure(() => analyse(entry.file, entry.target));
      expect(error.code).toBe(entry.error); expect(error.message.length).toBeGreaterThan(30);
      return;
    }
    const { result, progress } = await analyse(entry.file, entry.target, entry.password);
    expect(result!.format).toBe(entry.format);
    expect(result!.document.kind).toBe(entry.kind);
    expect(result!.rows.map(row => [row.amount, row.purchaseDate, row.description, row.provenance.page])).toEqual(entry.rows);
    expect(centsToMoney(result!.rows.reduce((sum, row) => sum + moneyToCents(row.amount!), 0n))).toBe(entry.total);
    // formatCents separates "R$" with a no-break space.
    for (const warning of entry.warnings ?? []) expect(result!.warnings.join('\n').replace(/\u00a0/g, ' ')).toContain(warning);
    // Every value points to its page, a normalized region and the original excerpt.
    for (const row of result!.rows) {
      expect(row.provenance.excerpt).toContain(row.amount!.replace('-', '').replace('.', ',').replace(/^(\d)(\d{3}),/, '$1.$2,'));
      expect(row.provenance.region!.x).toBeGreaterThanOrEqual(0); expect(row.provenance.region!.width).toBeGreaterThan(0);
      expect(row.provenance.region!.x + row.provenance.region!.width).toBeLessThanOrEqual(1.0001);
      if (entry.ocr) expect(row.provenance.confidence).toBeGreaterThan(60);
      else expect(row.provenance.confidence).toBeUndefined();
    }
    expect(progress.at(-1)?.phase).toBe('interpreting');
    expect(result!.document.ocrPages > 0).toBe(entry.ocr);
  }, 60_000);
});
describe('document jobs', () => {
  it('asks for the password, rejects a wrong one and never echoes it', async () => {
    const required = await failure(() => analyse('extrato-protegido.pdf', 'account'));
    expect(required.code).toBe('PASSWORD_REQUIRED');
    const wrong = await failure(() => analyse('extrato-protegido.pdf', 'account', 'senha-errada-123'));
    expect(wrong.code).toBe('PASSWORD_INCORRECT'); expect(wrong.message).not.toContain('senha-errada-123');
    expect((await analyse('extrato-protegido.pdf', 'account', DOCUMENT_PASSWORD)).result!.rows).toHaveLength(4);
  }, 30_000);
  it('degrades without OCR: digital PDFs still work, scans and photos explain the alternative', async () => {
    process.env.IMPORT_OCR = 'off';
    expect((await analyse('extrato-digital.pdf', 'account')).result!.rows).toHaveLength(6);
    const scan = await failure(() => analyse('extrato-escaneado.pdf', 'account'));
    expect(scan.code).toBe('OCR_UNAVAILABLE'); expect(scan.message).toContain('OCR está desativado');
    expect((await failure(() => analyse('extrato.webp', 'account'))).code).toBe('OCR_UNAVAILABLE');
  }, 30_000);
  it('times out long extractions and terminates the worker', async () => {
    process.env.IMPORT_DOCUMENT_TIMEOUT_MS = '1000';
    const error = await failure(() => analyse('extrato-escaneado.pdf', 'account'));
    expect(error.code).toBe('TIMEOUT'); expect(error.message).toContain('1 s');
  }, 30_000);
  it('stops when the batch is no longer ours and when cancelled locally, without reporting', async () => {
    const stopped = await analyse('extrato-escaneado.pdf', 'account', undefined, progress => progress.phase !== 'ocr');
    expect(stopped.result).toBeNull();
    expect(stopped.progress.map(p => p.phase)).toContain('ocr');
    const bytes = await documentBytes('extrato-escaneado.pdf');
    let reported = false;
    const first = startDocumentJob({ id: 'a', type: 'pdf', bytes }, { progress: async () => true, complete: async () => { reported = true; }, failed: async () => { reported = true; } });
    // Concurrency 1: the second job waits in the queue and is removed by cancellation.
    const second = startDocumentJob({ id: 'b', type: 'pdf', bytes }, { progress: async () => true, complete: async () => { reported = true; }, failed: async () => { reported = true; } });
    abortDocumentJob('b'); abortDocumentJob('a');
    await Promise.all([first, second]);
    expect(reported).toBe(false);
  }, 30_000);
});
