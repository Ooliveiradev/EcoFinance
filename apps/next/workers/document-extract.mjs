// Document extraction worker (EF-10). Runs in a worker_thread, never on the web
// request thread: pdf.js reads the text layer with coordinates, pages without text
// and raster images are rendered with @napi-rs/canvas and read by tesseract.js with
// local Portuguese data. Only positioned tokens leave this file; interpretation is
// deterministic TypeScript in src/lib/import-document.ts. The parent enforces the
// timeout and cancellation by terminating this thread. The PDF password arrives in
// workerData and is never written, logged or posted back.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { bytes, type, password, ocr, limits } = workerData;
const post = message => parentPort.postMessage(message);
const progress = (phase, page, pages) => post({ type: 'progress', phase, page, pages });
class ExtractError extends Error { constructor(code, message) { super(message); this.code = code; } }

const packageDir = name => dirname(require.resolve(`${name}/package.json`));
let tesseract = null;
async function ocrWorker() {
  if (tesseract) return tesseract;
  const { createWorker, OEM } = await import('tesseract.js');
  // Local traineddata only: no CDN download, no cache written to disk.
  tesseract = await createWorker('por', OEM.LSTM_ONLY, { langPath: join(packageDir('@tesseract.js-data/por'), '4.0.0_best_int'), cacheMethod: 'none', gzip: true });
  await tesseract.setParameters({ preserve_interword_spaces: '1' });
  return tesseract;
}
async function recognize(canvas, scale) {
  const worker = await ocrWorker();
  const { data } = await worker.recognize(canvas.toBuffer('image/png'), { rotateAuto: true }, { blocks: true, text: false });
  const tokens = [];
  for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) for (const word of line.words) {
    const text = word.text.trim();
    if (!text) continue;
    tokens.push({ text, x: word.bbox.x0 / scale, y: word.bbox.y0 / scale, width: (word.bbox.x1 - word.bbox.x0) / scale, height: (word.bbox.y1 - word.bbox.y0) / scale, confidence: Math.round(word.confidence) });
  }
  const confidence = tokens.length ? tokens.reduce((sum, token) => sum + token.confidence, 0) / tokens.length : null;
  return { tokens, confidence };
}
/** OCR with orientation fallback: a sideways or upside-down page reads with low confidence. */
async function readRaster(canvas, scale, width, height) {
  const { createCanvas } = require('@napi-rs/canvas');
  let best = { ...(await recognize(canvas, scale)), rotation: 0, width, height };
  if (best.confidence !== null && best.confidence >= 70 && best.tokens.length >= 5) return best;
  for (const rotation of [90, 270, 180]) {
    const turned = rotation === 180 ? createCanvas(canvas.width, canvas.height) : createCanvas(canvas.height, canvas.width);
    const context = turned.getContext('2d');
    context.translate(turned.width / 2, turned.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    const attempt = await recognize(turned, scale);
    if ((attempt.confidence ?? 0) * Math.min(1, attempt.tokens.length / 5) > (best.confidence ?? 0) * Math.min(1, best.tokens.length / 5) + 5)
      best = { ...attempt, rotation, width: rotation === 180 ? width : height, height: rotation === 180 ? height : width };
    if (best.rotation === rotation && best.confidence >= 85 && best.tokens.length >= 5) break;
  }
  return best;
}
function rasterScale(width, height, preferred) {
  return Math.min(preferred, Math.sqrt(limits.renderPixels / (width * height)));
}
/** Text items in display space, rotated so the dominant writing direction is horizontal. */
function textTokens(items, viewport, Util) {
  const raw = [];
  for (const item of items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const m = Util.transform(viewport.transform, item.transform);
    const angle = (Math.round(Math.atan2(m[1], m[0]) / (Math.PI / 2)) * 90 + 360) % 360;
    raw.push({ item, m, angle, size: Math.hypot(m[2], m[3]) });
  }
  const counts = new Map();
  for (const entry of raw) counts.set(entry.angle, (counts.get(entry.angle) ?? 0) + entry.item.str.length);
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const turn = ({ m }) => {
    const [x, y] = [m[4], m[5]], W = viewport.width, H = viewport.height;
    if (dominant === 90) return [y, W - x];
    if (dominant === 180) return [W - x, H - y];
    if (dominant === 270) return [H - y, x];
    return [x, y];
  };
  const swapped = dominant === 90 || dominant === 270;
  const tokens = raw.filter(entry => entry.angle === dominant).map(entry => {
    const [x, baseline] = turn(entry);
    return { text: entry.item.str, x, y: baseline - entry.size * 0.85, width: entry.item.width * (viewport.scale ?? 1), height: entry.size, confidence: null };
  });
  return { tokens, rotation: dominant, width: swapped ? viewport.height : viewport.width, height: swapped ? viewport.width : viewport.height };
}
async function readPdf() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dir = packageDir('pdfjs-dist'), slash = path => join(dir, path).replaceAll('\\', '/') + '/';
  let document;
  try {
    document = await pdfjs.getDocument({ data: bytes, password: password ?? undefined, enableXfa: false, verbosity: 0,
      maxImageSize: limits.inputPixels, canvasMaxAreaInBytes: limits.renderPixels * 4 * 2, standardFontDataUrl: slash('standard_fonts'), cMapUrl: slash('cmaps'), cMapPacked: true, wasmUrl: slash('wasm'), iccUrl: slash('iccs') }).promise;
  } catch (error) {
    if (error?.name === 'PasswordException') throw new ExtractError(error.code === 2 ? 'PASSWORD_INCORRECT' : 'PASSWORD_REQUIRED', error.code === 2 ? 'Senha incorreta. Confira e informe a senha do PDF novamente.' : 'PDF protegido por senha. Informe a senha para analisar; ela não é armazenada.');
    throw new ExtractError('CORRUPT_FILE', 'PDF corrompido ou incompleto. Baixe o documento novamente no site do banco.');
  }
  const pages = [], total = document.numPages;
  if (total > limits.pages) throw new ExtractError('PAGE_LIMIT', `O PDF tem ${total} páginas; o limite é ${limits.pages}. Envie as páginas do período em partes.`);
  let tokenCount = 0;
  for (let number = 1; number <= total; number++) {
    progress('reading', number, total);
    const page = await document.getPage(number), viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = textTokens(content.items, viewport, pdfjs.Util);
    const characters = text.tokens.reduce((sum, token) => sum + token.text.replace(/\s/g, '').length, 0);
    if (characters >= 20) {
      pages.push({ number, width: text.width, height: text.height, method: 'text', tokens: text.tokens, confidence: null, ...(text.rotation ? { rotation: text.rotation } : {}) });
    } else if (!ocr) {
      pages.push({ number, width: viewport.width, height: viewport.height, method: 'none', tokens: [], confidence: null });
    } else {
      progress('ocr', number, total);
      const scale = rasterScale(viewport.width, viewport.height, 300 / 72), rendered = page.getViewport({ scale });
      const { createCanvas } = require('@napi-rs/canvas');
      const canvas = createCanvas(Math.ceil(rendered.width), Math.ceil(rendered.height)), context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, canvas, viewport: rendered }).promise;
      const read = await readRaster(canvas, scale, viewport.width, viewport.height);
      pages.push({ number, width: read.width, height: read.height, method: read.tokens.length ? 'ocr' : 'none', tokens: read.tokens, confidence: read.confidence, ...(read.rotation ? { rotation: read.rotation } : {}) });
    }
    tokenCount += pages.at(-1).tokens.length;
    if (tokenCount > limits.tokens) throw new ExtractError('CONTENT_LIMIT', 'O documento tem texto demais para um lote. Envie somente as páginas com as movimentações.');
    page.cleanup();
  }
  await document.loadingTask.destroy();
  return pages;
}
async function readImage() {
  if (!ocr) throw new ExtractError('OCR_UNAVAILABLE', 'O OCR está desativado neste servidor, então imagens não podem ser lidas. Envie o PDF original do banco ou exporte OFX/CSV.');
  progress('ocr', 1, 1);
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  let image;
  try { image = await loadImage(Buffer.from(bytes)); } catch { throw new ExtractError('CORRUPT_FILE', 'Imagem corrompida ou incompleta. Exporte ou fotografe novamente.'); }
  if (image.width * image.height > limits.inputPixels) throw new ExtractError('PIXEL_LIMIT', 'Imagem acima do limite de pixels. Reduza a resolução.');
  // Small photos are enlarged (OCR needs ~20 px letters); large ones reduced to the render budget.
  const scale = rasterScale(image.width, image.height, Math.max(1, Math.min(2, 2000 / Math.max(image.width, image.height))));
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale)), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const read = await readRaster(canvas, scale, image.width, image.height);
  return [{ number: 1, width: read.width, height: read.height, method: read.tokens.length ? 'ocr' : 'none', tokens: read.tokens, confidence: read.confidence, ...(read.rotation ? { rotation: read.rotation } : {}) }];
}
try {
  const pages = type === 'pdf' ? await readPdf() : await readImage();
  progress('interpreting', pages.length, pages.length);
  post({ type: 'result', extraction: { type, pages, ocrAvailable: !!ocr } });
} catch (error) {
  post({ type: 'error', code: error instanceof ExtractError ? error.code : 'EXTRACTION_FAILED', message: error instanceof ExtractError ? error.message : 'Não foi possível ler o documento. Exporte novamente ou envie OFX/CSV.' });
} finally {
  await tesseract?.terminate().catch(() => {});
}
