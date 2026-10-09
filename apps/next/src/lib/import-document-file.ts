import { IMPORT_DOCUMENT_LIMITS } from '@ecofinance/shared';
import { parseError } from './import-errors';

/**
 * Content detection for documents (PDF and raster images). Dimensions come from
 * the container headers so the pixel budget is enforced before anything decodes.
 */
export type DocumentType = 'pdf' | 'png' | 'jpeg' | 'webp';
export interface DocumentFile { type: DocumentType; format: string; width: number | null; height: number | null }

const ascii = (bytes: Uint8Array, start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString('latin1');
const starts = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
/** Raster/document formats recognised only to explain which conversion is needed. */
function unsupported(bytes: Uint8Array) {
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'GIF';
  if (starts(bytes, [0x49, 0x49, 0x2a, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'TIFF';
  if (ascii(bytes, 0, 2) === 'BM' && bytes.length > 26) return 'BMP';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (/^(heic|heix|hevc|mif1|msf1|heis)$/.test(brand)) return 'HEIC/HEIF';
    if (/^avi[fs]$/.test(brand)) return 'AVIF';
  }
  if (starts(bytes, [0xff, 0x4f, 0xff, 0x51]) || ascii(bytes, 4, 8) === 'jP  ') return 'JPEG 2000';
  return null;
}
function pngSize(bytes: Uint8Array) {
  if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return null;
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
}
function jpegSize(bytes: Uint8Array) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < view.length) {
    if (view[offset] !== 0xff) return null;
    const marker = view[offset + 1]!;
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { offset += 2; continue; }
    const length = view.readUInt16BE(offset + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.readUInt16BE(offset + 7), height: view.readUInt16BE(offset + 5) };
    if (marker === 0xda || length < 2) return null;
    offset += 2 + length;
  }
  return null;
}
function webpSize(bytes: Uint8Array) {
  const chunk = ascii(bytes, 12, 16), view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === 'VP8 ' && bytes.length >= 30) return { width: view.readUInt16LE(26) & 0x3fff, height: view.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = view.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && bytes.length >= 30) return { width: view.readUIntLE(24, 3) + 1, height: view.readUIntLE(27, 3) + 1 };
  return null;
}
/** Null when the bytes are not a document (structured formats take over). */
export function detectDocument(bytes: Uint8Array): DocumentFile | null {
  if (/^\s*%PDF-\d/.test(ascii(bytes, 0, 32))) return { type: 'pdf', format: 'PDF', width: null, height: null };
  let size: { width: number; height: number } | null = null, type: DocumentType | null = null, format = '';
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) { type = 'png'; format = 'PNG'; size = pngSize(bytes); }
  else if (starts(bytes, [0xff, 0xd8, 0xff])) { type = 'jpeg'; format = 'JPEG'; size = jpegSize(bytes); }
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') { type = 'webp'; format = 'WebP'; size = webpSize(bytes); }
  else {
    const other = unsupported(bytes);
    if (other) parseError('UNSUPPORTED_FORMAT', `Imagem ${other} ainda não é aceita. Converta para PNG, JPEG ou WebP (ou salve como PDF) e envie novamente.`, other);
    return null;
  }
  if (!size || !size.width || !size.height) parseError('CORRUPT_FILE', `Cabeçalho de ${format} inválido ou truncado. Exporte a imagem novamente.`, format);
  return { type, format, width: size!.width, height: size!.height };
}
/** Size and pixel limits checked before the worker decodes anything. */
export function checkDocument(bytes: Uint8Array, file: DocumentFile) {
  if (bytes.length > IMPORT_DOCUMENT_LIMITS.bytes) parseError('FILE_LIMIT', `Documento excede ${IMPORT_DOCUMENT_LIMITS.bytes / 1024} KiB. Envie menos páginas, reduza a resolução ou exporte o extrato em OFX/CSV.`, file.format);
  if (file.width && file.height && file.width * file.height > IMPORT_DOCUMENT_LIMITS.inputPixels) parseError('PIXEL_LIMIT', `Imagem de ${file.width}×${file.height} pixels excede ${IMPORT_DOCUMENT_LIMITS.inputPixels / 1e6} megapixels. Reduza a resolução e envie novamente.`, file.format);
}
/** Sniff without throwing: upload limits only need to know whether bytes look like a document. */
export function looksLikeDocument(bytes: Uint8Array) {
  try { return !!detectDocument(bytes); } catch { return true; }
}
