// Minimal PDF writer for the synthetic document corpus. It emits only what the
// fixtures need: Helvetica text (WinAnsi), one JPEG image per page, page rotation
// and the standard security handler (RC4 128-bit, revision 3) for password tests.
import { createHash } from 'node:crypto';

export interface PdfText { x: number; y: number; text: string; size?: number; bold?: boolean }
export interface PdfImage { jpeg: Uint8Array; width: number; height: number }
export interface PdfPage { width?: number; height?: number; rotate?: number; texts?: PdfText[]; image?: PdfImage }
export interface PdfOptions { userPassword?: string; ownerPassword?: string }

const extra1252: Record<string, number> = { '–': 0x96, '—': 0x97, '•': 0x95, '“': 0x93, '”': 0x94, '€': 0x80 };
function winAnsi(text: string) {
  return Buffer.from([...text].map(char => {
    const code = extra1252[char] ?? char.charCodeAt(0);
    if (code > 0xff) throw new Error('not WinAnsi: ' + char);
    return code;
  }));
}
const escape = (bytes: Buffer) => Buffer.concat([...bytes].map(byte => [0x28, 0x29, 0x5c].includes(byte) ? Buffer.from([0x5c, byte]) : Buffer.from([byte])));

function rc4(key: Uint8Array, data: Uint8Array) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i]! + key[i % key.length]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!]; }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255; j = (j + s[i]!) & 255; [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}
const md5 = (...parts: Uint8Array[]) => createHash('md5').update(Buffer.concat(parts)).digest();
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const padded = (password: string) => Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);

/** Standard security handler, algorithms 2, 3 and 5 of ISO 32000-1 (R3, 128-bit). */
function security(user: string, owner: string, id: Buffer) {
  const permissions = -3904; // print and copy allowed; irrelevant for parsing
  let ownerKey = md5(padded(owner));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  let o = Buffer.from(rc4(ownerKey, padded(user)));
  for (let i = 1; i <= 19; i++) o = Buffer.from(rc4(ownerKey.map(byte => byte ^ i), o));
  const p = Buffer.alloc(4); p.writeInt32LE(permissions);
  let key = md5(padded(user), o, p, id);
  for (let i = 0; i < 50; i++) key = md5(key);
  let u = Buffer.from(rc4(key, md5(PAD, id)));
  for (let i = 1; i <= 19; i++) u = Buffer.from(rc4(key.map(byte => byte ^ i), u));
  u = Buffer.concat([u, Buffer.alloc(16)]);
  const objectKey = (num: number) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 16);
  return { o, u, permissions, encrypt: (num: number, data: Uint8Array) => rc4(objectKey(num), data) };
}

export function buildPdf(pages: PdfPage[], options: PdfOptions = {}): Uint8Array {
  const objects: (Buffer | null)[] = [];
  const reserve = () => { objects.push(null); return objects.length; };
  const catalog = reserve(), tree = reserve(), regular = reserve(), bold = reserve();
  const id = createHash('md5').update(JSON.stringify(pages.map(p => p.texts ?? []))).digest();
  const sec = options.userPassword !== undefined || options.ownerPassword !== undefined ? security(options.userPassword ?? '', options.ownerPassword ?? 'owner-synthetic', id) : null;
  const streams = new Map<number, Buffer>();
  const set = (num: number, dict: string, stream?: Uint8Array) => {
    objects[num - 1] = Buffer.from(dict, 'latin1');
    if (stream) streams.set(num, Buffer.from(sec ? sec.encrypt(num, stream) : stream));
  };
  set(regular, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  set(bold, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const page of pages) {
    const width = page.width ?? 595, height = page.height ?? 842, pageNum = reserve(), contentNum = reserve();
    let imageNum = 0;
    const parts: Buffer[] = [];
    if (page.image) {
      imageNum = reserve();
      set(imageNum, `<< /Type /XObject /Subtype /Image /Width ${page.image.width} /Height ${page.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.jpeg.length} >>`, page.image.jpeg);
      parts.push(Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`));
    }
    for (const text of page.texts ?? []) parts.push(Buffer.concat([Buffer.from(`BT /${text.bold ? 'F2' : 'F1'} ${text.size ?? 10} Tf ${text.x} ${text.y} Td (`), escape(winAnsi(text.text)), Buffer.from(') Tj ET\n')]));
    const content = Buffer.concat(parts);
    set(contentNum, `<< /Length ${content.length} >>`, content);
    set(pageNum, `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${width} ${height}]${page.rotate ? ` /Rotate ${page.rotate}` : ''} /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >>${imageNum ? ` /XObject << /Im0 ${imageNum} 0 R >>` : ''} >> /Contents ${contentNum} 0 R >>`);
    kids.push(pageNum);
  }
  set(tree, `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  set(catalog, '<< /Type /Catalog /Pages 2 0 R >>');
  let encryptNum = 0;
  if (sec) {
    encryptNum = reserve();
    set(encryptNum, `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${sec.permissions} /O <${sec.o.toString('hex')}> /U <${sec.u.toString('hex')}> >>`);
  }
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = chunks[0]!.length;
  objects.forEach((dict, index) => {
    const num = index + 1, stream = streams.get(num);
    const body = Buffer.concat([Buffer.from(`${num} 0 obj\n`), dict!, stream ? Buffer.concat([Buffer.from('\nstream\n'), stream, Buffer.from('\nendstream')]) : Buffer.alloc(0), Buffer.from('\nendobj\n')]);
    offsets.push(length); chunks.push(body); length += body.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)].join('');
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>]${encryptNum ? ` /Encrypt ${encryptNum} 0 R` : ''} >>\nstartxref\n${length}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([...chunks, Buffer.from(xref + trailer)]));
}
