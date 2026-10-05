export async function readJson(request: Request, limit: number): Promise<unknown | Response> {
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); return Response.json({ error: 'BODY_TOO_LARGE' }, { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { return Response.json({ error: 'INVALID_INPUT' }, { status: 400 }); }
}
