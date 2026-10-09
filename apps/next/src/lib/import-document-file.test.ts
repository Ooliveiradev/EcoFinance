import { describe, expect, it } from 'vitest';
import { IMPORT_DOCUMENT_LIMITS } from '@ecofinance/shared';
import { checkDocument, detectDocument, looksLikeDocument } from './import-document-file';
import { ImportParseError } from './import-errors';

const bytes = (...parts: (string | number[])[]) => new Uint8Array(Buffer.concat(parts.map(part => typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));
const u32 = (value: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return [...b]; };
const png = (width: number, height: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32(13), 'IHDR', u32(width), u32(height), [8, 2, 0, 0, 0]);
const jpeg = (marker: number, width: number, height: number) => bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xff, 0xd0, 0xff, marker, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3, 0, 0, 0, 0]);
const riff = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body);
function failure(run: () => unknown) {
  try { run(); } catch (error) { if (error instanceof ImportParseError) return error; throw error; }
  throw new Error('expected diagnostic');
}

describe('document detection', () => {
  it('recognises PDF by signature, tolerating leading whitespace', () => {
    expect(detectDocument(bytes('%PDF-1.7\n'))).toEqual({ type: 'pdf', format: 'PDF', width: null, height: null });
    expect(detectDocument(bytes('\r\n %PDF-2.0'))?.type).toBe('pdf');
    expect(detectDocument(bytes('Data;Valor\n%PDF-1.4'))).toBeNull();
  });
  it('reads raster dimensions from headers without decoding', () => {
    expect(detectDocument(png(800, 600))).toEqual({ type: 'png', format: 'PNG', width: 800, height: 600 });
    expect(detectDocument(jpeg(0xc0, 1024, 768))).toMatchObject({ type: 'jpeg', width: 1024, height: 768 });
    expect(detectDocument(jpeg(0xc2, 10, 20))).toMatchObject({ width: 10, height: 20 });
    const vp8 = Array(10).fill(0); vp8[6] = 0x40; vp8[7] = 0x01; vp8[8] = 0xf0;
    expect(detectDocument(riff('VP8 ', vp8))).toMatchObject({ type: 'webp', format: 'WebP', width: 320, height: 240 });
    expect(detectDocument(riff('VP8L', [0x2f, 0x63, 0xc0, 0x3b, 0x00]))).toMatchObject({ width: 100, height: 240 });
    expect(detectDocument(riff('VP8X', [0, 0, 0, 0, 99, 0, 0, 49, 0, 0]))).toMatchObject({ width: 100, height: 50 });
  });
  it('rejects truncated or malformed raster headers as corrupt', () => {
    expect(failure(() => detectDocument(png(800, 600).subarray(0, 20))).code).toBe('CORRUPT_FILE');
    expect(failure(() => detectDocument(png(0, 10))).code).toBe('CORRUPT_FILE');
    expect(failure(() => detectDocument(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0, 0, 0, 0, 0]))).code).toBe('CORRUPT_FILE');
    expect(failure(() => detectDocument(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0x12, 0, 0, 0, 0, 0]))).code).toBe('CORRUPT_FILE');
    expect(failure(() => detectDocument(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]))).code).toBe('CORRUPT_FILE');
    expect(failure(() => detectDocument(riff('ABCD', Array(14).fill(0)))).code).toBe('CORRUPT_FILE');
  });
  it('names formats that need conversion', () => {
    for (const [file, label] of [
      [bytes('GIF89a', Array(20).fill(0)), 'GIF'], [bytes('GIF87a'), 'GIF'], [bytes([0x49, 0x49, 0x2a, 0]), 'TIFF'], [bytes([0x4d, 0x4d, 0, 0x2a]), 'TIFF'],
      [bytes('BM', Array(30).fill(0)), 'BMP'], [bytes([0, 0, 0, 24], 'ftypheic'), 'HEIC/HEIF'], [bytes([0, 0, 0, 24], 'ftypavif'), 'AVIF'],
      [bytes([0xff, 0x4f, 0xff, 0x51]), 'JPEG 2000'], [bytes([0, 0, 0, 12], 'jP  '), 'JPEG 2000'],
    ] as const) {
      const error = failure(() => detectDocument(file));
      expect([error.code, error.format]).toEqual(['UNSUPPORTED_FORMAT', label]);
      expect(error.message).toContain('PNG, JPEG ou WebP');
    }
    expect(detectDocument(bytes([0, 0, 0, 24], 'ftypisom'))).toBeNull();
    expect(detectDocument(bytes('BM'))).toBeNull();
  });
  it('flags document-like uploads for the larger size limit without throwing', () => {
    expect(looksLikeDocument(bytes('%PDF-1.4'))).toBe(true);
    expect(looksLikeDocument(bytes('GIF89a'))).toBe(true);
    expect(looksLikeDocument(bytes('Data;Valor'))).toBe(false);
  });
});
describe('document limits', () => {
  it('bounds bytes and decoded pixels before extraction', () => {
    const pdf = { type: 'pdf' as const, format: 'PDF', width: null, height: null };
    expect(() => checkDocument(new Uint8Array(IMPORT_DOCUMENT_LIMITS.bytes), pdf)).not.toThrow();
    expect(failure(() => checkDocument(new Uint8Array(IMPORT_DOCUMENT_LIMITS.bytes + 1), pdf)).code).toBe('FILE_LIMIT');
    expect(failure(() => checkDocument(new Uint8Array(10), { type: 'png', format: 'PNG', width: 10000, height: 10000 })).message).toContain('10000×10000');
    expect(() => checkDocument(new Uint8Array(10), { type: 'png', format: 'PNG', width: 4000, height: 3000 })).not.toThrow();
  });
});
