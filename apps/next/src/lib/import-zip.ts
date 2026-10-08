import { inflateRawSync } from 'node:zlib';
import { parseError } from './import-errors';

/** Decompression budget for XLSX containers, checked before any spreadsheet parser runs. */
export const ZIP_LIMITS = { entries: 300, entryBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024 } as const;
const FORMAT = 'XLSX';

/**
 * Validate a ZIP container without trusting its headers: no ZIP64, encryption,
 * duplicate names or overlapping entries, and every entry is inflated under a
 * hard output limit to prove its real size matches the declared one.
 */
export function inspectZip(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) if (data.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) parseError('CORRUPT_FILE', 'Arquivo ZIP/XLSX incompleto. Salve a planilha novamente.', FORMAT);
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), offset = data.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) parseError('UNSUPPORTED_FORMAT', 'ZIP64 ou multivolume não é aceito. Salve a planilha como XLSX comum.', FORMAT);
  if (count > ZIP_LIMITS.entries || offset + size > end) parseError('UNSAFE_CONTENT', 'Estrutura ZIP inválida ou com entradas demais.', FORMAT);
  const names = new Set<string>(), ranges: [number, number][] = [];
  let cursor = offset, total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) parseError('CORRUPT_FILE', 'Diretório ZIP corrompido. Salve a planilha novamente.', FORMAT);
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10), compressed = data.readUInt32LE(cursor + 20), declared = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32), local = data.readUInt32LE(cursor + 42);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extra + comment;
    if (flags & 1) parseError('PROTECTED_FILE', 'Planilha criptografada ou protegida por senha. Remova a senha ou exporte CSV.', FORMAT);
    if (names.has(name)) parseError('UNSAFE_CONTENT', 'ZIP com entradas repetidas não é aceito.', FORMAT);
    names.add(name);
    if (method !== 0 && method !== 8) parseError('UNSUPPORTED_FORMAT', 'Compressão ZIP não suportada. Salve a planilha como XLSX comum.', FORMAT);
    total += declared;
    if (declared > ZIP_LIMITS.entryBytes || total > ZIP_LIMITS.totalBytes) parseError('UNSAFE_CONTENT', 'Planilha expande além do limite seguro (possível zip bomb). Exporte apenas o extrato.', FORMAT);
    if (local + 30 > offset || data.readUInt32LE(local) !== 0x04034b50) parseError('CORRUPT_FILE', 'Entrada ZIP corrompida. Salve a planilha novamente.', FORMAT);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28), stop = start + compressed;
    if (stop > offset) parseError('CORRUPT_FILE', 'Entrada ZIP ultrapassa o arquivo. Salve a planilha novamente.', FORMAT);
    ranges.push([local, stop]);
    const raw = data.subarray(start, stop);
    let actual = raw.length;
    if (method === 8) {
      try { actual = inflateRawSync(raw, { maxOutputLength: Math.max(1, declared) }).length; }
      catch { parseError('UNSAFE_CONTENT', 'Conteúdo compactado inválido ou maior que o declarado (possível zip bomb).', FORMAT); }
    }
    if (actual !== declared) parseError('UNSAFE_CONTENT', 'Tamanho real de uma entrada diverge do declarado no ZIP.', FORMAT);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some(([start], i) => i > 0 && start < ranges[i - 1]![1])) parseError('UNSAFE_CONTENT', 'Entradas ZIP sobrepostas (possível zip bomb).', FORMAT);
  return [...names];
}
