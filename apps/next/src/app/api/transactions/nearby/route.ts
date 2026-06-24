// ---------------------------------------------------------------------------
// GET /api/transactions/nearby — Find geographically nearby transactions
// Uses the PostGIS RPC function buscar_lancamentos_proximos
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@ecofinance/db';
import { nearbySearchParamsSchema } from '@ecofinance/shared';
import { sql } from 'drizzle-orm';

function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-secret-key');
  const expected = process.env.API_SECRET_KEY;
  if (!expected) return false;
  return apiKey === expected;
}

interface NearbyTransactionRow {
  id: string;
  account_id: string;
  description: string;
  amount: string;
  date: Date;
  category: string;
  source: string;
  latitude: number;
  longitude: number;
  distance_meters: number;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Validate API key ───────────────────────────────────────────────
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing API key' },
        { status: 401 },
      );
    }

    // ── 2. Read query params ──────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const rawParams = {
      latitude: searchParams.get('lat') ? Number(searchParams.get('lat')) : undefined,
      longitude: searchParams.get('lng') ? Number(searchParams.get('lng')) : undefined,
      radiusMeters: searchParams.get('radius')
        ? Number(searchParams.get('radius'))
        : undefined,
    };

    // ── 3. Validate with schema ───────────────────────────────────────────
    const parseResult = nearbySearchParamsSchema.safeParse(rawParams);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { latitude, longitude, radiusMeters } = parseResult.data;

    // ── 4. Call PostGIS RPC via raw SQL through Drizzle ────────────────────
    const result = await db.execute<NearbyTransactionRow>(
      sql`SELECT * FROM buscar_lancamentos_proximos(${latitude}, ${longitude}, ${radiusMeters})`,
    );

    // ── 5. Map results to response format ─────────────────────────────────
    const nearbyTransactions = result.rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      description: row.description,
      amount: Number(row.amount),
      date: row.date,
      category: row.category,
      source: row.source,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMeters: Math.round(row.distance_meters * 100) / 100,
    }));

    return NextResponse.json(
      {
        results: nearbyTransactions,
        count: nearbyTransactions.length,
        searchParams: { latitude, longitude, radiusMeters },
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/transactions/nearby] Error:', error);

    // Handle case where the PostGIS function doesn't exist yet
    if (message.includes('buscar_lancamentos_proximos')) {
      return NextResponse.json(
        {
          error:
            'PostGIS function buscar_lancamentos_proximos not found. Run the database migration first.',
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: `Internal server error: ${message}` },
      { status: 500 },
    );
  }
}
