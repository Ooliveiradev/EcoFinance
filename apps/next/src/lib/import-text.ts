/** Text decoding for structured imports. The encoding is always reported. */
export interface DecodedText { text: string; encoding: string; warnings: string[] }

// Bytes without a Windows-1252 mapping; their presence means the file is not 1252/Latin-1.
const undefined1252 = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
const labels: Record<string, string> = { '1252': 'windows-1252', 'windows-1252': 'windows-1252', cp1252: 'windows-1252', '8859-1': 'latin1', 'iso-8859-1': 'latin1', 'iso8859-1': 'latin1', latin1: 'latin1', 'latin-1': 'latin1', 'utf-8': 'utf-8', utf8: 'utf-8' };

/** Charset declared by an OFX SGML header (CHARSET:1252) or an XML prolog. */
export function declaredCharset(bytes: Uint8Array) {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  const value = /^\s*CHARSET\s*:\s*([\w-]+)/im.exec(head)?.[1] ?? /<\?xml[^>]*\bencoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1];
  return value ? labels[value.toLowerCase()] ?? null : null;
}
function decode(label: string, bytes: Uint8Array) {
  return new TextDecoder(label, { fatal: true }).decode(bytes);
}
/**
 * Decode BOM-marked UTF-8/UTF-16 and strict UTF-8. Only when UTF-8 is invalid,
 * fall back to a declared charset or to Windows-1252/Latin-1, which is the common
 * export of Brazilian banks and Excel. Undecodable bytes return null.
 */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: decode('utf-8', bytes.subarray(3)), encoding: 'UTF-8 com BOM', warnings: [] };
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decode('utf-16le', bytes.subarray(2)), encoding: 'UTF-16 LE', warnings: [] };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decode('utf-16be', bytes.subarray(2)), encoding: 'UTF-16 BE', warnings: [] };
  } catch { return null; }
  try { return { text: decode('utf-8', bytes), encoding: 'UTF-8', warnings: [] }; } catch { /* legacy single-byte below */ }
  if (bytes.some(byte => undefined1252.has(byte))) return null;
  const declared = declaredCharset(bytes);
  const windows = bytes.some(byte => byte >= 0x80 && byte <= 0x9f);
  const encoding = windows || declared === 'windows-1252' ? 'Windows-1252' : 'ISO-8859-1 (Latin-1)';
  // WHATWG maps Latin-1 labels to Windows-1252, which is a superset for printable bytes.
  return { text: decode('windows-1252', bytes), encoding, warnings: [`Arquivo não está em UTF-8; decodificado como ${encoding}${declared && declared !== 'utf-8' ? ' conforme declarado no cabeçalho' : ''}. Confira acentos e descrições.`] };
}
