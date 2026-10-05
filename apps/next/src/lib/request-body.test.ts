import { describe, expect, it } from 'vitest';
import { readJson } from './request-body';
describe('bounded JSON bodies', () => {
  it('counts UTF-8 bytes rather than characters and accepts the exact limit', async () => {
    const text = '{"message":"á"}';
    const bytes = new TextEncoder().encode(text).length;
    expect(await readJson(new Request('https://test.invalid',{method:'POST',body:text}),bytes)).toEqual({message:'á'});
    const result = await readJson(new Request('https://test.invalid',{method:'POST',body:text}),bytes-1);
    expect(result).toBeInstanceOf(Response); expect((result as Response).status).toBe(413);
  });
  it('rejects no body, malformed JSON and invalid UTF-8 without logging payloads', async () => {
    for (const body of [undefined, '{bad', new Uint8Array([0xff])]) {
      const result = await readJson(new Request('https://test.invalid',{method:'POST',body}),100);
      expect((result as Response).status).toBe(400);
    }
  });
  it('counts streamed chunks, ignores a misleading Content-Length and cancels on overflow', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(5)); c.enqueue(new Uint8Array(7)); }, cancel(){cancelled=true;} });
    const request = new Request('https://test.invalid',{method:'POST',body:stream,headers:{'content-length':'1'},duplex:'half'} as RequestInit);
    expect((await readJson(request,10) as Response).status).toBe(413); expect(cancelled).toBe(true);
  });
});
