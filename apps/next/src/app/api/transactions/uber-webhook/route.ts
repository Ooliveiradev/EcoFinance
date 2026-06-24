// ---------------------------------------------------------------------------
// POST /api/transactions/uber-webhook — Receive parsed Uber trip data from GAS
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@ecofinance/db';
import { accounts, transactions, uberTripsMetadata } from '@ecofinance/db/src/schema';
import { uberWebhookPayloadSchema } from '@ecofinance/shared';
import { eq, and, gte, lte, between, sql } from 'drizzle-orm';

function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-secret-key');
  const expected = process.env.API_SECRET_KEY;
  if (!expected) return false;
  return apiKey === expected;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // ── 1. Validate API key ───────────────────────────────────────────────
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing API key' },
        { status: 401 },
      );
    }

    // ── 2. Parse and validate body ────────────────────────────────────────
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parseResult = uberWebhookPayloadSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { valor, data_hora, endereco_partida, endereco_destino, nome_motorista, duracao_segundos } =
      parseResult.data;

    // ── 3. Create uber_trips_metadata record ──────────────────────────────
    const [metadata] = await db
      .insert(uberTripsMetadata)
      .values({
        originAddress: endereco_partida,
        destinationAddress: endereco_destino,
        driverName: nome_motorista ?? null,
        durationSeconds: duracao_segundos ?? null,
      })
      .returning();

    // ── 4. Search for matching transaction ────────────────────────────────
    // Match criteria: same date ±2 hours, similar amount ±R$2.00
    const tripDate = new Date(data_hora);
    const twoHoursBefore = new Date(tripDate.getTime() - 2 * 60 * 60 * 1000);
    const twoHoursAfter = new Date(tripDate.getTime() + 2 * 60 * 60 * 1000);

    const amountLower = valor - 2.0;
    const amountUpper = valor + 2.0;

    const matchingTransactions = await db
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.date, twoHoursBefore),
          lte(transactions.date, twoHoursAfter),
          sql`CAST(${transactions.amount} AS numeric) BETWEEN ${amountLower} AND ${amountUpper}`,
        ),
      )
      .limit(1);

    if (matchingTransactions.length > 0) {
      // ── 5a. Found match — link metadata and update category ─────────────
      const matchedTxn = matchingTransactions[0];

      await db
        .update(transactions)
        .set({
          uberMetadataId: metadata.id,
          category: 'transporte',
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, matchedTxn.id));

      return NextResponse.json(
        {
          matched: true,
          transactionId: matchedTxn.id,
          metadataId: metadata.id,
          message: 'Uber metadata linked to existing transaction',
        },
        { status: 200 },
      );
    } else {
      // ── 5b. No match — create new transaction with uber metadata ────────
      // Find or create a default account for Uber transactions
      let accountId: string;

      const uberAccounts = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.name, 'Uber'))
        .limit(1);

      if (uberAccounts.length > 0) {
        accountId = uberAccounts[0].id;
      } else {
        const [newAccount] = await db
          .insert(accounts)
          .values({
            name: 'Uber',
            type: 'carteira',
            balance: '0',
          })
          .returning({ id: accounts.id });

        accountId = newAccount.id;
      }

      const externalId = `uber_${tripDate.getTime()}_${Math.round(valor * 100)}`;

      const [newTxn] = await db
        .insert(transactions)
        .values({
          accountId,
          description: `Uber: ${endereco_partida} → ${endereco_destino}`,
          amount: String(-Math.abs(valor)), // Uber trips are expenses (negative)
          date: tripDate,
          category: 'transporte',
          source: 'uber',
          externalId,
          uberMetadataId: metadata.id,
        })
        .returning();

      return NextResponse.json(
        {
          matched: false,
          transactionId: newTxn.id,
          metadataId: metadata.id,
          message: 'New Uber transaction created',
        },
        { status: 201 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/transactions/uber-webhook] Error:', error);
    return NextResponse.json(
      { error: `Internal server error: ${message}` },
      { status: 500 },
    );
  }
}
