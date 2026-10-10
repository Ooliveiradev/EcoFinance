// Extraction worker for PDF and image imports (#10). Runs in its own thread with
// a memory limit; the server terminates it on timeout or cancellation. It returns
// only positioned words: interpretation stays in apps/next/src/lib, in the server.
// Nothing here uses the network: fonts, CMaps and the Portuguese OCR model are
// read from node_modules. The PDF password lives only in this thread's memory.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const load = id => import(pathToFileURL(require.resolve(id)).href);
// pdfjs reads fonts, CMaps, ICC profiles and WASM decoders (JPEG 2000) from these folders.
const pdfjsData = folder => path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), folder).replaceAll('\\', '/') + '/';
const { bytes, format, password, limits, ocr: ocrAllowed } = workerData;
// OCR confidence (0–100) under which another orientation is attempted.
const RETRY_BELOW = 70;

class Failure extends Error { constructor(code) { super(code); this.code = code; } }
const progress = (page, pages, stage) => parentPort.postMessage({ type: 'progress', page, pages, stage });
const alnum = text => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
// Strictly one step at a time: a single OCR engine, and one page in memory at once.
const inOrder = (items, step) => items.reduce((previous, item) => previous.then(async done => [...done, await step(item)]), Promise.resolve([]));

let canvasModule, tesseract;
async function canvas() { return canvasModule ??= await load('@napi-rs/canvas'); }
async function ocr() {
  if (tesseract) return tesseract;
  const { createWorker, OEM } = await load('tesseract.js');
  tesseract = await createWorker('por', OEM.LSTM_ONLY, {
    langPath: path.dirname(require.resolve('@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz')),
    gzip: true, cacheMethod: 'none', logger: () => {}, errorHandler: () => {},
  });
  await tesseract.setParameters({ preserve_interword_spaces: '1' });
  return tesseract;
}
/** Copy onto a white canvas rotated clockwise by `rotation` degrees. */
async function rotated(source, rotation) {
  const { createCanvas } = await canvas();
  const swap = rotation % 180 !== 0, width = swap ? source.height : source.width, height = swap ? source.width : source.height;
  const target = createCanvas(width, height), context = target.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2); context.rotate(rotation * Math.PI / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return target;
}
async function recognize(image) {
  const engine = await ocr(), result = await engine.recognize(await image.encode('png'), {}, { blocks: true, text: false });
  const words = (result.data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)))
    .filter(word => word.text.trim())
    .map(word => ({ text: word.text, x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0, confidence: Math.round(word.confidence) }));
  const chars = alnum(words.map(w => w.text).join(''));
  const confidence = words.length ? Math.round(words.reduce((total, word) => total + word.confidence * word.text.length, 0) / words.reduce((total, word) => total + word.text.length, 0)) : 0;
  return { words, confidence, score: confidence * Math.min(1, chars / 12) };
}
/** OCR upright first; a weak reading is retried at 90°, 180° and 270° and the best one kept. */
async function readImage(source, scale, page, pages) {
  // The server allows OCR only with enough free memory (see ocrAvailable).
  if (!ocrAllowed) throw new Failure('OCR_UNAVAILABLE');
  progress(page, pages, 'ocr');
  let best = { rotation: 0, image: source, ...(await recognize(source)) };
  if (best.confidence < RETRY_BELOW || best.score < RETRY_BELOW) await inOrder([90, 180, 270], async rotation => {
    const image = await rotated(source, rotation), attempt = await recognize(image);
    if (attempt.score > best.score) best = { rotation, image, ...attempt };
  });
  return {
    page, width: best.image.width / scale, height: best.image.height / scale, method: 'ocr', rotation: best.rotation,
    confidence: best.words.length ? best.confidence : null,
    words: best.words.map(word => ({ ...word, x: word.x / scale, y: word.y / scale, width: word.width / scale, height: word.height / scale })),
  };
}
async function readPdf() {
  const pdfjs = await load('pdfjs-dist/legacy/build/pdf.mjs');
  let task, document;
  try {
    task = pdfjs.getDocument({
      data: bytes, password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false,
      standardFontDataUrl: pdfjsData('standard_fonts'), cMapUrl: pdfjsData('cmaps'), cMapPacked: true, wasmUrl: pdfjsData('wasm'), iccUrl: pdfjsData('iccs'),
      maxImageSize: limits.renderPixels, verbosity: 0,
    });
    document = await task.promise;
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Failure(error.code === 2 ? 'PASSWORD_INVALID' : 'PASSWORD_REQUIRED');
    throw new Failure('CORRUPT_FILE');
  }
  if (document.numPages > limits.pages) throw new Failure('PAGE_LIMIT');
  const result = await inOrder(Array.from({ length: document.numPages }, (_, i) => i + 1), async number => {
    progress(number, document.numPages, 'text');
    const page = await document.getPage(number), viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words = content.items.filter(item => item.str?.trim()).map(item => {
      const matrix = pdfjs.Util.transform(viewport.transform, item.transform), height = Math.hypot(matrix[2], matrix[3]);
      return { text: item.str, x: matrix[4], y: matrix[5] - height, width: item.width * viewport.scale, height, confidence: null };
    });
    if (alnum(words.map(w => w.text).join('')) >= 10) {
      page.cleanup();
      return { page: number, width: viewport.width, height: viewport.height, method: 'text', rotation: 0, confidence: null, words };
    }
    // A page without a text layer is scanned: render it within the pixel budget and read it.
    const scale = Math.min(3, Math.sqrt(limits.renderPixels / (viewport.width * viewport.height)));
    const view = page.getViewport({ scale }), { createCanvas } = await canvas();
    const image = createCanvas(Math.floor(view.width), Math.floor(view.height)), context = image.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, image.width, image.height);
    await page.render({ canvas: image, canvasContext: context, viewport: view }).promise;
    const read = await readImage(image, scale, number, document.numPages);
    page.cleanup();
    return read;
  });
  await task.destroy();
  return result;
}
async function readPicture() {
  const { loadImage, createCanvas } = await canvas();
  let picture;
  try { picture = await loadImage(Buffer.from(bytes)); } catch { throw new Failure('CORRUPT_FILE'); }
  if (!picture.width || !picture.height) throw new Failure('CORRUPT_FILE');
  if (picture.width * picture.height > limits.imagePixels) throw new Failure('PIXEL_LIMIT');
  // Downscale large photos to the render budget; transparency becomes white paper.
  const scale = Math.min(1, Math.sqrt(limits.renderPixels / (picture.width * picture.height)));
  const image = createCanvas(Math.max(1, Math.round(picture.width * scale)), Math.max(1, Math.round(picture.height * scale))), context = image.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, image.width, image.height);
  context.drawImage(picture, 0, 0, image.width, image.height);
  return [await readImage(image, scale, 1, 1)];
}
try {
  const pages = format === 'pdf' ? await readPdf() : await readPicture();
  parentPort.postMessage({ type: 'result', extraction: { format, pages, warnings: [] } });
} catch (error) {
  parentPort.postMessage({ type: 'error', code: error instanceof Failure ? error.code : 'EXTRACTION_FAILED' });
} finally {
  await tesseract?.terminate().catch(() => {});
}
