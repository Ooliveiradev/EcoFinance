import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PluggyClient } from '@/lib/pluggy-client';

export async function GET(request: NextRequest) {
  const expected = process.env.API_SECRET_KEY;
  const received = request.headers.get('x-api-secret-key');
  if (!expected || expected.length < 32 || !received || Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const clientId = process.env.PLUGGY_CLIENT_ID;
    const clientSecret = process.env.PLUGGY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Credenciais do Pluggy ausentes no servidor (.env).' },
        { status: 500 }
      );
    }

    const client = new PluggyClient(clientId, clientSecret);
    const token = await client.createConnectToken();

    return NextResponse.json({ accessToken: token });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create connect token' },
      { status: 500 }
    );
  }
}
