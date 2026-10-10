import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { IMPORT_DOCUMENT_LIMITS, IMPORT_LIMITS, type ImportProgress } from '@ecofinance/shared';
import { FinanceError } from './finance-operation';
import { parseError } from './import-errors';
import { interpretDocument, type DocumentExtraction, type DocumentFormat } from './import-document-layout';
import { mimeWarnings, parseImport, type ImportFile, type ParseOptions, type ParsedImport } from './import-parsers';

/**
 * PDF and image imports (#10). The signature and declared dimensions are checked
 * here, before any decoder runs; extraction runs in a separate worker thread with
 * memory, page, pixel and time limits, so a large or hostile file cannot block the
 * server. Formats without a validated adapter get a conversion hint.
 */
const ascii = (bytes: Uint8Array, start: number, length: number) => Buffer.from(bytes.subarray(start, start + length)).toString('latin1');
export function documentFormat(bytes: Uint8Array): DocumentFormat | null {
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}
/** Image and document families recognized only to explain the conversion needed. */
export function unsupportedDocument(bytes: Uint8Array): string | null {
  const head = ascii(bytes, 0, 12);
  if (/^GIF8[79]a/.test(head)) return 'GIF';
  if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'TIFF';
  // BMP declares its own size; text such as "BMW;..." is not mistaken for it.
  if (head.startsWith('BM') && bytes.length >= 6 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(2, true) === bytes.length) return 'BMP';
  if (ascii(bytes, 4, 4) === 'ftyp' && /^(?:heic|heix|hevc|mif1|msf1|avif)/.test(ascii(bytes, 8, 4))) return ascii(bytes, 8, 4) === 'avif' ? 'AVIF' : 'HEIC';
  if (/^\s*<svg\b/i.test(Buffer.from(bytes.subarray(0, 256)).toString('utf8'))) return 'SVG';
  return null;
}
const be16 = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!, le16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const le24 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
/** Dimensions from the image header only; null when the header is truncated or invalid. */
export function imageSize(bytes: Uint8Array, format: Exclude<DocumentFormat, 'pdf'>): { width: number; height: number } | null {
  if (format === 'png') return bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR' ? { width: new DataView(bytes.buffer, bytes.byteOffset).getUint32(16), height: new DataView(bytes.buffer, bytes.byteOffset).getUint32(20) } : null;
  if (format === 'webp') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8 ' && bytes.length >= 30) return { width: le16(bytes, 26) & 0x3fff, height: le16(bytes, 28) & 0x3fff };
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) return { width: 1 + (((bytes[22]! & 0x3f) << 8) | bytes[21]!), height: 1 + (((bytes[24]! & 0x0f) << 10) | (bytes[23]! << 2) | ((bytes[22]! & 0xc0) >> 6)) };
    if (chunk === 'VP8X' && bytes.length >= 30) return { width: 1 + le24(bytes, 24), height: 1 + le24(bytes, 27) };
    return null;
  }
  // JPEG: walk the markers up to the first start-of-frame.
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: be16(bytes, i + 5), width: be16(bytes, i + 7) };
    i += 2 + be16(bytes, i + 2);
  }
  return null;
}
/** Decoders render a truncated image partially; require the format's end marker instead. */
export function complete(bytes: Uint8Array, format: DocumentFormat) {
  const tail = ascii(bytes, Math.max(0, bytes.length - 1024), 1024);
  if (format === 'pdf') return tail.includes('%%EOF');
  if (format === 'png') return ascii(bytes, bytes.length - 8, 4) === 'IEND';
  if (format === 'jpeg') return /\xff\xd9[\s\0]*$/.test(ascii(bytes, Math.max(0, bytes.length - 64), 64));
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true) + 8 <= bytes.length;
}
const labels: Record<DocumentFormat, string> ={ pdf: 'PDF', png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };
const messages: Record<string, string> = {
  PASSWORD_REQUIRED: 'PDF protegido por senha. Informe a senha para analisar; ela é usada só nesta análise e não é guardada.',
  PASSWORD_INVALID: 'Senha do PDF incorreta. Confira e informe novamente; nada foi guardado.',
  PAGE_LIMIT: `Documento com mais de ${IMPORT_DOCUMENT_LIMITS.pages} páginas. Envie só as páginas com as movimentações.`,
  PIXEL_LIMIT: 'Imagem com resolução acima do limite. Reduza a resolução ou recorte a área com as movimentações.',
  CORRUPT_FILE: 'Documento corrompido, truncado ou ilegível. Exporte ou fotografe novamente.',
  EXTRACTION_FAILED: 'A leitura do documento falhou. Repita a análise; se persistir, exporte OFX, CSV ou planilha.',
  OCR_UNAVAILABLE: 'A leitura óptica (OCR) está indisponível agora nesta instalação. PDFs com texto continuam funcionando; repita mais tarde ou envie o PDF original do banco, OFX ou CSV.',
  DOCUMENT_TIMEOUT: `A leitura excedeu ${IMPORT_DOCUMENT_LIMITS.seconds} segundos. Envie menos páginas ou uma imagem menor.`,
};
/**
 * One extraction at a time per server process: OCR peaks at about 250 MiB, and the
 * service runs with 512 MiB. Others wait briefly for the slot, then get a retry hint.
 */
let slot: Promise<void> = Promise.resolve();
async function exclusive<T>(signal: AbortSignal | undefined, waitMs: number, run: () => Promise<T>): Promise<T> {
  const previous = slot; let release!: () => void;
  slot = new Promise<void>(resolve => { release = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const waited = await Promise.race([previous.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), waitMs); })]);
    if (!waited) throw new FinanceError('DOCUMENT_BUSY', 503, 'Outro documento está sendo lido neste momento. Repita a análise em instantes; nada foi alterado.');
    if (signal?.aborted) throw new FinanceError('BATCH_STATE', 409, 'A análise foi cancelada.');
    return await run();
  } finally {
    clearTimeout(timer);
    // A slot that timed out waiting releases only after its predecessor finishes.
    void previous.then(release);
  }
}
/**
 * OCR needs about 250 MiB on top of the server. Under a container memory limit it
 * runs only with that headroom free, so a busy instance refuses OCR instead of
 * being killed with everyone's requests. `IMPORT_OCR=off` turns it off entirely;
 * PDFs with a text layer never need it.
 */
export function ocrAvailable() {
  if (process.env.IMPORT_OCR === 'off') return false;
  const limit = process.constrainedMemory?.() ?? 0;
  if (!limit || limit >= 2 ** 50) return true;
  return process.memoryUsage().rss + IMPORT_DOCUMENT_LIMITS.ocrHeadroomMb * 2 ** 20 <= limit;
}
function workerPath() {
  const candidates = [process.env.ECOFINANCE_DOCUMENT_WORKER, path.join(process.cwd(), 'workers', 'document-worker.mjs'), path.join(process.cwd(), 'apps', 'next', 'workers', 'document-worker.mjs')];
  const found = candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate));
  if (!found) throw new FinanceError('DOCUMENT_READER_UNAVAILABLE', 503, 'O leitor de documentos não está disponível nesta instalação. Exporte OFX, CSV ou planilha.');
  return found;
}
export interface ExtractOptions { password?: string; signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void; timeoutMs?: number; queueMs?: number }
/** Run the extraction worker; it is terminated on timeout or when `signal` aborts. */
export function extractDocument(bytes: Uint8Array, format: DocumentFormat, options: ExtractOptions = {}): Promise<DocumentExtraction> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new FinanceError('BATCH_STATE', 409, 'A análise foi cancelada.')); return; }
    const worker = new Worker(workerPath(), {
      workerData: { bytes: new Uint8Array(bytes), format, password: options.password, limits: IMPORT_DOCUMENT_LIMITS, ocr: ocrAvailable() },
      // The JS heap bound covers pdfjs; Tesseract's WASM memory is bounded by the page pixel budget.
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 48 }, stdout: true, stderr: true,
    });
    // Worker output is drained, never logged: pdfjs warnings could quote document text.
    worker.stdout.resume(); worker.stderr.resume();
    let settled = false;
    const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); void worker.terminate(); action(); };
    const fail = (code: string) => finish(() => reject(parseErrorOf(code, format)));
    const abort = () => finish(() => reject(new FinanceError('BATCH_STATE', 409, 'A análise foi cancelada.')));
    const timer = setTimeout(() => fail('DOCUMENT_TIMEOUT'), options.timeoutMs ?? IMPORT_DOCUMENT_LIMITS.seconds * 1000);
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: { type: string; code?: string; extraction?: DocumentExtraction } & ImportProgress) => {
      if (message.type === 'progress') options.onProgress?.({ page: message.page, pages: message.pages, stage: message.stage });
      else if (message.type === 'result') finish(() => resolve(message.extraction!));
      else if (message.type === 'error') fail(message.code ?? 'EXTRACTION_FAILED');
    });
    // Memory limit, crash or an early exit: never a partial result.
    worker.on('error', () => fail('EXTRACTION_FAILED'));
    worker.on('exit', () => fail('EXTRACTION_FAILED'));
  });
}
function parseErrorOf(code: string, format: DocumentFormat) {
  try { parseError(code, messages[code] ?? messages.EXTRACTION_FAILED!, labels[format]); } catch (error) { return error; }
}
export interface DocumentOptions extends ParseOptions, ExtractOptions {}
/** Every format: PDF and images through the document reader, the rest through the tabular parsers. */
export async function parseImportFile(file: ImportFile, options: DocumentOptions = {}): Promise<ParsedImport> {
  const format = documentFormat(file.bytes);
  if (!format) {
    const other = unsupportedDocument(file.bytes);
    if (other) parseError('UNSUPPORTED_FORMAT', `${other} ainda não é suportado. Converta para PNG, JPEG, WebP ou PDF e envie novamente.`, other);
    return parseImport(file, options);
  }
  if (file.bytes.length > IMPORT_LIMITS.bytes) parseError('FILE_LIMIT', 'Arquivo excede 256 KiB. Envie menos páginas ou uma imagem menor.', labels[format]);
  if (!complete(file.bytes, format)) parseError('CORRUPT_FILE', 'Arquivo truncado: o envio ou a exportação não terminou. Gere o arquivo novamente.', labels[format]);
  if (format !== 'pdf') {
    const size = imageSize(file.bytes, format);
    if (!size || !size.width || !size.height) parseError('CORRUPT_FILE', messages.CORRUPT_FILE!, labels[format]);
    if (size!.width * size!.height > IMPORT_DOCUMENT_LIMITS.imagePixels) parseError('PIXEL_LIMIT', messages.PIXEL_LIMIT!, labels[format]);
  }
  const extraction = await exclusive(options.signal, options.queueMs ?? IMPORT_DOCUMENT_LIMITS.queueSeconds * 1000, () => extractDocument(file.bytes, format, options));
  const result = interpretDocument(extraction);
  return { source: 'document', accountHint: null, rows: result.rows, format: result.format, warnings: [...result.warnings, ...mimeWarnings(file, 'document')], documentKind: result.kind };
}
