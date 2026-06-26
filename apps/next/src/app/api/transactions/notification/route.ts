// ---------------------------------------------------------------------------
// POST /api/transactions/notification — Receive real-time notification txns
// from the Android app with GPS deduplication
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@ecofinance/db';
import { accounts, transactions } from '@ecofinance/db';
import {
  notificationTransactionSchema,
  generateDeduplicationHash,
} from '@ecofinance/shared';
import { eq, and, gte, sql } from 'drizzle-orm';

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

    const parseResult = notificationTransactionSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { description, amount, bankName, latitude, longitude, timestamp } =
      parseResult.data;

    // ── 3. Generate deduplication hash ────────────────────────────────────
    const dedupHash = generateDeduplicationHash(amount, bankName, timestamp);

    // ── 4. Check for duplicates in the last 5 minutes ─────────────────────
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const existingDuplicates = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.externalId, dedupHash),
          gte(transactions.createdAt, fiveMinutesAgo),
        ),
      )
      .limit(1);

    if (existingDuplicates.length > 0) {
      return NextResponse.json(
        {
          status: 'duplicate',
          message: 'Transaction already recorded within the last 5 minutes',
          transactionId: existingDuplicates[0].id,
        },
        { status: 200 },
      );
    }

    // ── 5. Find or create account by bank name ────────────────────────────
    let accountId: string;

    const existingAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.name, bankName))
      .limit(1);

    if (existingAccounts.length > 0) {
      accountId = existingAccounts[0].id;
    } else {
      const [newAccount] = await db
        .insert(accounts)
        .values({
          name: bankName,
          type: 'banco',
          balance: '0',
        })
        .returning({ id: accounts.id });

      accountId = newAccount.id;
    }

    // ── 6. Insert transaction with GPS coordinates ────────────────────────
    const [created] = await db
      .insert(transactions)
      .values({
        accountId,
        description,
        amount: String(amount),
        date: new Date(timestamp),
        category: 'desconhecido',
        source: 'notification',
        externalId: dedupHash,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
      })
      .returning();

    // ── 7. Auto-populate geom column via trigger (if lat/lng present) ─────
    // The DB trigger handles setting geom from lat/lng automatically.

    return NextResponse.json(
      {
        status: 'created',
        transaction: {
          id: created.id,
          description: created.description,
          amount: created.amount,
          date: created.date,
          latitude: created.latitude,
          longitude: created.longitude,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/transactions/notification] Error:', error);
    return NextResponse.json(
      { error: `Internal server error: ${message}` },
      { status: 500 },
    );
  }
}
