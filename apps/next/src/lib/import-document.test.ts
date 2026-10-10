import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { IMPORT_DOCUMENT_LIMITS } from '@ecofinance/shared';
import { ImportParseError } from './import-errors';
import { documentFormat, imageSize, ocrAvailable, parseImportFile, unsupportedDocument } from './import-document';
import { invoicePages, invoiceRows, picture, protectedPdf, receiptPage, scannedInvoicePage, scannedPdf, statementPage, statementRows, textPdf } from '../../../../tests/fixtures/documents/build';

/** Real extraction worker over the synthetic corpus: pdfjs text, rendering and local OCR. */
const files = new Map<string, Uint8Array>();
beforeAll(async () => {
  files.set('fatura.pdf', await textPdf(invoicePages));
  files.set('extrato.pdf', await textPdf([statementPage]));
  files.set('fatura-escaneada.pdf', await scannedPdf([scannedInvoicePage]));
  files.set('fatura-girada.pdf', await scannedPdf([scannedInvoicePage], 90));
  files.set('comprovante.png', await picture(receiptPage, 'png'));
  files.set('comprovante.webp', await picture(receiptPage, 'webp', { quality: 85 }));
  files.set('extrato.jpg', await picture(statementPage, 'jpeg', { quality: 70 }));
  files.set('borrado.jpg', await picture(receiptPage, 'jpeg', { quality: 40, blur: 9 }));
  files.set('protegido.pdf', protectedPdf(['FATURA DO CARTAO DE CREDITO', 'Vencimento 10/10/2026', 'Data Descricao Valor', '12/09 MERCADO EXEMPLO 45,90', 'Total de lancamentos 45,90'], 'segredo-123'));
  files.set('sem-movimentos.pdf', await textPdf([{ rows: ['BANCO EXEMPLO', 'Informe de rendimentos', 'Nenhuma movimentacao no periodo'] }]));
  files.set('faltando.pdf', await textPdf([{ rows: [invoicePages[0]!.rows[0]!, ...invoicePages[0]!.rows.slice(2, 8), 'Pagina 1 de 3'] }]));
  files.set('longo.pdf', await textPdf(Array.from({ length: IMPORT_DOCUMENT_LIMITS.pages + 1 }, () => ({ rows: ['Pagina'] }))));
}, 120_000);
const parse = (name: string, options = {}) => parseImportFile({ name, mime: 'application/octet-stream', bytes: files.get(name)! }, options);
const rows = (parsed: Awaited<ReturnType<typeof parse>>) => parsed.rows.map(row => [row.amount, row.purchaseDate, row.description, row.provenance.page]);
async function failure(run: () => Promise<unknown>) {
  try { await run(); } catch (cause) { if (cause instanceof ImportParseError) return cause; throw cause; }
  throw new Error('expected an import diagnostic');
}

describe('document reader', () => {
  it('reads a digital multipage invoice with repeated headers, payments and a matching total', async () => {
    const parsed = await parse('fatura.pdf');
    expect(parsed.format).toBe('PDF digital · fatura de cartão'); expect(parsed.documentKind).toBe('invoice');
    expect(rows(parsed)).toEqual(invoiceRows);
    const warnings = parsed.warnings.join(' ');
    expect(warnings).toContain('Cabeçalho da tabela repetido 2 vezes');
    expect(warnings).toContain('1 pagamento(s) de fatura ficaram fora da revisão');
    expect(warnings).toContain('Soma das linhas confere com o total do documento');
    expect(parsed.rows[0]!.warnings.join(' ')).toContain('Ano 2025 inferido pela vencimento 10/10/2026');
    for (const row of parsed.rows) {
      expect(row.provenance.method).toBe('text'); expect(row.provenance.excerpt).toBeTruthy();
      expect(row.provenance.region!.width).toBeGreaterThan(0); expect(row.provenance.region!.y).toBeLessThan(1);
    }
  }, 60_000);
  it('reads a statement by its value column, ignoring balances and joining wrapped descriptions', async () => {
    const parsed = await parse('extrato.pdf');
    expect(parsed.format).toBe('PDF digital · extrato');
    expect(parsed.rows.map(row => [row.amount, row.purchaseDate, row.description])).toEqual(statementRows);
    expect(parsed.warnings.join(' ')).toContain('Saldo anterior + movimentações confere com o saldo final');
    expect(parsed.warnings.join(' ')).toContain('2 linha(s) de saldo');
  }, 60_000);
  it('OCRs a scanned PDF and a page scanned sideways to the same rows as the digital text', async () => {
    for (const name of ['fatura-escaneada.pdf', 'fatura-girada.pdf']) {
      const parsed = await parse(name);
      expect(parsed.format).toBe('PDF escaneado (OCR) · fatura de cartão');
      expect(parsed.rows.map(row => [row.amount, row.purchaseDate, row.description])).toEqual([['-123.45', '2026-09-12', 'MERCADO BOM PRECO'], ['-234.56', '2026-09-15', 'FARMACIA SAUDE']]);
      expect(parsed.rows.every(row => row.provenance.method === 'ocr' && row.provenance.confidence! > 0)).toBe(true);
      expect(parsed.warnings.join(' ')).toContain('Soma das linhas confere');
      if (name === 'fatura-girada.pdf') expect(parsed.warnings.join(' ')).toMatch(/lida girada (90|270)°/);
    }
  }, 120_000);
  it('reads a receipt image as one entry from its total', async () => {
    for (const name of ['comprovante.png', 'comprovante.webp']) {
      const parsed = await parse(name);
      expect(parsed.format).toMatch(/^Imagem (PNG|WebP) \(OCR\) · comprovante$/);
      expect(rows(parsed)).toEqual([['-27.50', '2026-10-03', 'PADARIA EXEMPLO LTDA', 1]]);
      expect(parsed.rows[0]!.warnings.join(' ')).toContain('Comprovante tratado como saída');
    }
  }, 60_000);
  it('reads a statement photographed as JPEG', async () => {
    const parsed = await parse('extrato.jpg');
    expect(parsed.format).toBe('Imagem JPEG (OCR) · extrato');
    expect(parsed.rows.map(row => [row.amount, row.purchaseDate, row.description])).toEqual(statementRows);
  }, 60_000);
  it('never reports invented entries for an unreadable photo', async () => {
    try {
      const parsed = await parse('borrado.jpg');
      // If anything was read, each row is flagged and nothing is complete without review.
      expect(parsed.warnings.join(' ')).toMatch(/baixa legibilidade|ilegível|confiança/);
      for (const row of parsed.rows) expect(row.warnings.length).toBeGreaterThan(0);
    } catch (cause) {
      expect(cause).toBeInstanceOf(ImportParseError); expect(['LOW_QUALITY', 'NO_ROWS']).toContain((cause as ImportParseError).code);
    }
  }, 60_000);
  it('asks for the password of a protected PDF and uses it only for that analysis', async () => {
    expect((await failure(() => parse('protegido.pdf'))).code).toBe('PASSWORD_REQUIRED');
    const wrong = await failure(() => parse('protegido.pdf', { password: 'errada' }));
    expect(wrong.code).toBe('PASSWORD_INVALID'); expect(wrong.message).not.toContain('errada');
    const parsed = await parse('protegido.pdf', { password: 'segredo-123' });
    expect(rows(parsed)).toEqual([['-45.90', '2026-09-12', 'MERCADO EXEMPLO', 1]]);
  }, 60_000);
  it('fails documents without transactions, with missing pages flagged and page limits enforced', async () => {
    expect((await failure(() => parse('sem-movimentos.pdf'))).code).toBe('NO_ROWS');
    expect((await parse('faltando.pdf')).warnings.join(' ')).toContain('O documento indica 3 página(s), mas o arquivo tem 1');
    expect((await failure(() => parse('longo.pdf'))).code).toBe('PAGE_LIMIT');
  }, 60_000);
  it('reads one document at a time per process and asks to retry when the slot stays busy', async () => {
    const slow = parse('fatura-escaneada.pdf'), queued = parse('comprovante.png');
    await expect(parse('fatura.pdf', { queueMs: 1 })).rejects.toMatchObject({ code: 'DOCUMENT_BUSY', status: 503 });
    // Waiting analyses run in order once the slot is free; a refused one does not block them.
    await expect(slow).resolves.toMatchObject({ format: 'PDF escaneado (OCR) · fatura de cartão' });
    await expect(queued).resolves.toMatchObject({ rows: [{ amount: '-27.50' }] });
    await expect(parse('fatura.pdf')).resolves.toMatchObject({ format: 'PDF digital · fatura de cartão' });
  }, 60_000);
  it('stops at the time limit and on cancellation without a partial result', async () => {
    expect((await failure(() => parse('fatura-escaneada.pdf', { timeoutMs: 1 }))).code).toBe('DOCUMENT_TIMEOUT');
    const controller = new AbortController(); controller.abort();
    await expect(parse('fatura.pdf', { signal: controller.signal })).rejects.toMatchObject({ code: 'BATCH_STATE' });
    const progress: unknown[] = [];
    await parse('fatura.pdf', { onProgress: (p: unknown) => progress.push(p) });
    expect(progress).toEqual([{ page: 1, pages: 2, stage: 'text' }, { page: 2, pages: 2, stage: 'text' }]);
  }, 60_000);
});
describe('document signatures', () => {
  const png = (width: number, height: number) => { const b = Buffer.alloc(45); Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); b.write('IEND', 37, 'latin1'); return new Uint8Array(b); };
  it('detects formats by content and reads dimensions from headers only', async () => {
    expect(documentFormat(files.get('fatura.pdf')!)).toBe('pdf'); expect(documentFormat(files.get('extrato.jpg')!)).toBe('jpeg');
    expect(documentFormat(files.get('comprovante.webp')!)).toBe('webp'); expect(documentFormat(png(1, 1))).toBe('png');
    expect(imageSize(png(640, 480), 'png')).toEqual({ width: 640, height: 480 });
    expect(imageSize(files.get('extrato.jpg')!, 'jpeg')).toEqual({ width: 1190, height: 1684 });
    expect(imageSize(files.get('comprovante.webp')!, 'webp')).toEqual({ width: 840, height: 840 });
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), 'jpeg')).toBeNull();
  });
  it('reads WebP lossless and extended headers', () => {
    const webp = (chunk: string, body: number[]) => { const b = Buffer.alloc(32); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(24, 4); b.write('WEBP', 8, 'latin1'); b.write(chunk, 12, 'latin1'); Buffer.from(body).copy(b, 20); return new Uint8Array(b); };
    expect(imageSize(webp('VP8L', [0x2f, 0x3f, 0xc0, 0x3f, 0x00]), 'webp')).toEqual({ width: 64, height: 256 });
    expect(imageSize(webp('VP8X', [0, 0, 0, 0, 99, 0, 0, 49, 0, 0]), 'webp')).toEqual({ width: 100, height: 50 });
    expect(imageSize(webp('ALPH', []), 'webp')).toBeNull(); expect(imageSize(new Uint8Array(10), 'png')).toBeNull();
  });
  it('hands tabular files to the structured parsers, even when they start like a bitmap', async () => {
    expect(unsupportedDocument(new TextEncoder().encode('BMW;Data;Valor\nPeca;01/10/2026;-10,00\n'))).toBeNull();
    await expect(parseImportFile({ name: 'a.csv', mime: 'text/csv', bytes: new TextEncoder().encode('Data;Descrição;Valor\n25/10/2026;Mercado;-10,00\n') })).resolves.toMatchObject({ source: 'csv', rows: [{ amount: '-10.00' }] });
  });
  it('turns a crashing worker into a diagnostic, never a partial result', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'worker-')), 'crash.mjs');
    writeFileSync(file, "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ type: 'progress', page: 1, pages: 2, stage: 'text' }); throw new Error('boom');");
    process.env.ECOFINANCE_DOCUMENT_WORKER = file;
    try { expect((await failure(() => parse('fatura.pdf'))).code).toBe('EXTRACTION_FAILED'); } finally { delete process.env.ECOFINANCE_DOCUMENT_WORKER; }
  });
  it('refuses OCR without memory headroom or when switched off, while text PDFs keep working', async () => {
    expect(ocrAvailable()).toBe(true);
    const memory = vi.spyOn(process, 'constrainedMemory').mockReturnValue(process.memoryUsage().rss + 64 * 2 ** 20);
    try {
      expect(ocrAvailable()).toBe(false);
      expect((await failure(() => parse('comprovante.png'))).code).toBe('OCR_UNAVAILABLE');
      await expect(parse('fatura.pdf')).resolves.toMatchObject({ format: 'PDF digital · fatura de cartão' });
    } finally { memory.mockRestore(); }
    process.env.IMPORT_OCR = 'off';
    try { expect((await failure(() => parse('fatura-escaneada.pdf'))).message).toContain('PDFs com texto continuam funcionando'); } finally { delete process.env.IMPORT_OCR; }
  }, 60_000);
  it('reports an installation without the extraction worker', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());
    try { await expect(parse('fatura.pdf')).rejects.toMatchObject({ code: 'DOCUMENT_READER_UNAVAILABLE', status: 503 }); } finally { cwd.mockRestore(); }
  });
  it('rejects decompression bombs, truncated images and formats without an adapter before decoding', async () => {
    const run = (bytes: Uint8Array) => failure(() => parseImportFile({ name: 'x', mime: '', bytes }));
    expect((await run(png(20_000, 20_000))).code).toBe('PIXEL_LIMIT');
    expect((await run(png(0, 10))).code).toBe('CORRUPT_FILE');
    for (const name of ['comprovante.png', 'extrato.jpg', 'comprovante.webp', 'fatura.pdf']) expect((await run(files.get(name)!.slice(0, -200))).code).toBe('CORRUPT_FILE');
    for (const [head, label] of [['GIF89a', 'GIF'], ['II*\0', 'TIFF'], ['BM \0\0\0', 'BMP'], ['\0\0\0\x18ftypheic', 'HEIC'], ['\0\0\0\x18ftypavif', 'AVIF'], ['<svg xmlns="x">', 'SVG']] as const) {
      const bytes = new Uint8Array(Buffer.from(head.padEnd(32, '\0'), 'latin1'));
      expect(unsupportedDocument(bytes)).toBe(label);
      const error = await run(bytes); expect(error.code).toBe('UNSUPPORTED_FORMAT'); expect(error.message).toContain('PNG, JPEG, WebP ou PDF');
    }
  });
});
