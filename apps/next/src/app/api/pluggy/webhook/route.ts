import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { POST as sync } from '../sync/route';

const eventSchema = z.object({ event: z.string().max(100), itemId: z.string().uuid().optional() });

export async function POST(request: NextRequest) {
  const secret = process.env.API_SECRET_KEY;
  const token = request.headers.get('x-api-secret-key');
  if (!secret || secret.length < 32 || !token || Buffer.byteLength(token) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const parsed = eventSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
    if (parsed.data.event === 'item/updated' && parsed.data.itemId) {
      // Call the server handler directly; never forward credentials to a Host-derived URL.
      const response = await sync(new NextRequest('https://localhost/api/pluggy/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-secret-key': secret },
        body: JSON.stringify({ itemId: parsed.data.itemId }),
      }));
      if (!response.ok) return NextResponse.json({ error: 'Sync failed' }, { status: 502 });
      return NextResponse.json({ received: true, synced: true });
    }
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
