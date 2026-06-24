import { NextResponse } from 'next/server';
import { PluggyClient } from '@/lib/pluggy-client';

export async function GET() {
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
  } catch (error: any) {
    console.error('Failed to create Pluggy connect token:', error);
    return NextResponse.json(
      { error: 'Failed to create connect token' },
      { status: 500 }
    );
  }
}
