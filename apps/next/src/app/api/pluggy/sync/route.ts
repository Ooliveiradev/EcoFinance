// ---------------------------------------------------------------------------
// POST /api/pluggy/sync — Synchronize transactions from Pluggy Open Finance
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { db, accounts, transactions, eq } from '@ecofinance/db';
import { pluggySyncRequestSchema, categorizeTransaction } from '@ecofinance/shared';
import { PluggyClient, PluggyApiError } from '@/lib/pluggy-client';

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

    // ── 2. Validate request body ──────────────────────────────────────────
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parseResult = pluggySyncRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { itemId } = parseResult.data;

    // ── 3. Validate Pluggy credentials ────────────────────────────────────
    const clientId = process.env.PLUGGY_CLIENT_ID;
    const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Server misconfigured: missing Pluggy credentials' },
        { status: 500 },
      );
    }

    const pluggy = new PluggyClient(clientId, clientSecret);

    // ── 4. Fetch accounts from Pluggy ─────────────────────────────────────
    const pluggyAccounts = await pluggy.getAccounts(itemId);
    if (pluggyAccounts.length === 0) {
      return NextResponse.json(
        { error: 'No accounts found for this item' },
        { status: 404 },
      );
    }

    let totalSynced = 0;
    const errors: string[] = [];

    // ── 5. Date range: last 30 days ───────────────────────────────────────
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
    const toDate = now.toISOString().split('T')[0];

    for (const pluggyAccount of pluggyAccounts) {
      try {
        // ── 6. Upsert local account ─────────────────────────────────────────
        const existingAccounts = await db
          .select()
          .from(accounts)
          .where(eq(accounts.pluggyAccountId, pluggyAccount.id))
          .limit(1);

        let localAccountId: string;

        if (existingAccounts.length > 0) {
          localAccountId = existingAccounts[0]?.id ?? '';

          // Update balance
          await db
            .update(accounts)
            .set({
              balance: String(pluggyAccount.balance),
              updatedAt: new Date(),
            })
            .where(eq(accounts.id, localAccountId));
        } else {
          // Create new account
          const result = await db
            .insert(accounts)
            .values({
              name: pluggyAccount.name || pluggyAccount.marketingName || 'Conta Pluggy',
              type: 'banco',
              balance: String(pluggyAccount.balance),
              pluggyItemId: itemId,
              pluggyAccountId: pluggyAccount.id,
            })
            .returning({ id: accounts.id });

          const newAccount = result[0];
          if (!newAccount) {
            throw new Error(`Failed to insert account for pluggyAccountId=${pluggyAccount.id}`);
          }
          localAccountId = newAccount.id;
        }

        // ── 7. Fetch transactions ─────────────────────────────────────────
        const pluggyTransactions = await pluggy.getTransactions(
          pluggyAccount.id,
          fromDate,
          toDate,
        );

        // ── 8. Upsert each transaction ────────────────────────────────────
        for (const txn of pluggyTransactions) {
          try {
            const category = categorizeTransaction(txn.description || txn.descriptionRaw || '');
            const externalId = `pluggy_${txn.id}`;

            await db
              .insert(transactions)
              .values({
                accountId: localAccountId,
                description: txn.description || txn.descriptionRaw || 'Sem descrição',
                amount: String(txn.amount),
                date: new Date(txn.date),
                category,
                source: 'pluggy',
                externalId,
              })
              .onConflictDoUpdate({
                target: transactions.externalId,
                set: {
                  description: txn.description || txn.descriptionRaw || 'Sem descrição',
                  amount: String(txn.amount),
                  date: new Date(txn.date),
                  category,
                  updatedAt: new Date(),
                },
              });

            totalSynced++;
          } catch (txnError) {
            const message =
              txnError instanceof Error ? txnError.message : String(txnError);
            errors.push(`Transaction ${txn.id}: ${message}`);
          }
        }
      } catch (accountError) {
        const message =
          accountError instanceof Error ? accountError.message : String(accountError);
        errors.push(`Account ${pluggyAccount.id}: ${message}`);
      }
    }

    return NextResponse.json(
      { synced: totalSynced, errors },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof PluggyApiError) {
      return NextResponse.json(
        { error: `Pluggy API error: ${error.message}`, statusCode: error.statusCode },
        { status: 502 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/pluggy/sync] Unexpected error:', error);
    return NextResponse.json(
      { error: `Internal server error: ${message}` },
      { status: 500 },
    );
  }
}
