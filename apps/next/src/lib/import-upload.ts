import { IMPORT_LIMITS } from '@ecofinance/shared';
import { authorize } from './session';
import { PRIVATE_CACHE } from './access-policy';
import { financeError } from './finance-http';
import { fail } from './finance-operation';
import { receiveImports } from './import-store';
import type { Database } from '@ecofinance/db';

/** Bound the stream before multipart parsing, independent of Content-Length. */
export async function uploadImports(db: Database, request: Request) {
  try {
    const access = await authorize(request); if (access.response) return access.response;
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) fail('INVALID_UPLOAD', 400, 'Envie os arquivos como multipart/form-data.');
    const max = IMPORT_LIMITS.files * IMPORT_LIMITS.bytes + 64 * 1024;
    const reader = request.body?.getReader(); if (!reader) fail('EMPTY_UPLOAD', 400, 'Selecione os arquivos.');
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const { done, value } = await reader!.read(); if (done) break; length += value.length; if (length > max) { await reader!.cancel(); fail('UPLOAD_LIMIT', 413, 'Upload excede o limite. Envie até 10 arquivos de 256 KiB.'); } chunks.push(value); }
    } finally { reader!.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    let form: FormData;
    try { form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('content-type')! }, body: bytes }).formData(); }
    catch { fail('INVALID_UPLOAD', 400, 'Upload incompleto. Selecione os arquivos e tente novamente.'); }
    if ([...form!.keys()].some(key => !['files', 'accountId', 'cardId'].includes(key))) fail('INVALID_UPLOAD', 400, 'Campos de upload desconhecidos.');
    const account = form!.getAll('accountId'), card = form!.getAll('cardId');
    if (account.length > 1 || card.length > 1 || [...account, ...card].some(v => typeof v !== 'string')) fail('INVALID_TARGET', 400, 'Destino de upload inválido.');
    const entries = form!.getAll('files');
    if (!entries.length || entries.length > IMPORT_LIMITS.files || entries.some(file => !(file instanceof File))) fail('FILE_COUNT', 400, 'Selecione de 1 a 10 arquivos.');
    const files = await Promise.all((entries as File[]).map(async file => ({ name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })));
    const result = await receiveImports(db, access.userId, request.headers.get('idempotency-key') ?? '', files, { accountId: String(account[0] ?? '') || null, cardId: String(card[0] ?? '') || null });
    return Response.json(result, { status: 201, headers: { 'Cache-Control': PRIVATE_CACHE } });
  } catch (error) { return financeError(error); }
}
