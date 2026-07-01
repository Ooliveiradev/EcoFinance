// ---------------------------------------------------------------------------
// POST /api/transactions/import-ofx — Import transactions from OFX/QFX file
// ---------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { db, accounts, transactions, eq } from '@ecofinance/db';
import { categorizeTransaction } from '@ecofinance/shared';
import { parseOfxContent } from '@/lib/ofx-parser';

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

    // ── 2. Read multipart form data ───────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'Invalid form data. Expected multipart/form-data with a file upload.' },
        { status: 400 },
      );
    }

    const file = formData.get('file');
    const accountName = formData.get('accountName');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Missing "file" field. Upload an .ofx or .qfx file.' },
        { status: 400 },
      );
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.ofx') && !fileName.endsWith('.qfx')) {
      return NextResponse.json(
        { error: 'Invalid file type. Only .ofx and .qfx files are accepted.' },
        { status: 400 },
      );
    }

    // ── 3. Parse OFX content ──────────────────────────────────────────────
    const rawContent = await file.text();
    if (!rawContent.trim()) {
      return NextResponse.json(
        { error: 'File is empty' },
        { status: 400 },
      );
    }

    const parsed = parseOfxContent(rawContent);

    if (parsed.transactions.length === 0) {
      return NextResponse.json(
        { error: 'No transactions found in the OFX file' },
        { status: 400 },
      );
    }

    // ── 4. Get or create account ──────────────────────────────────────────
    const resolvedAccountName =
      typeof accountName === 'string' && accountName.trim()
        ? accountName.trim()
        : `Conta ${parsed.accountId || 'OFX'}`;

    let accountId: string;

    const existingAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.name, resolvedAccountName))
      .limit(1);

    if (existingAccounts.length > 0) {
      accountId = existingAccounts[0]?.id ?? '';

      // Update balance if available
      if (parsed.balanceAmount !== null) {
        await db
          .update(accounts)
          .set({
            balance: String(parsed.balanceAmount),
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, accountId));
      }
    } else {
      const result = await db
        .insert(accounts)
        .values({
          name: resolvedAccountName,
          type: 'banco',
          balance: parsed.balanceAmount !== null ? String(parsed.balanceAmount) : '0',
        })
        .returning({ id: accounts.id });

      const newAccount = result[0];
      if (!newAccount) throw new Error('Failed to create account');
      accountId = newAccount.id;
    }

    // ── 5. Bulk insert transactions ───────────────────────────────────────
    let imported = 0;
    let skipped = 0;

    for (const txn of parsed.transactions) {
      const externalId = `ofx_${parsed.accountId || 'unknown'}_${txn.fitId}`;
      const category = categorizeTransaction(txn.name || txn.memo || '');

      try {
        const result = await db
          .insert(transactions)
          .values({
            accountId,
            description: txn.name || txn.memo || 'Transação OFX',
            amount: String(txn.amount),
            date: new Date(txn.datePosted),
            category,
            source: 'ofx',
            externalId,
          })
          .onConflictDoNothing({
            target: transactions.externalId,
          })
          .returning({ id: transactions.id });

        if (result.length > 0) {
          imported++;
        } else {
          skipped++;
        }
      } catch (insertError) {
        // If an individual insert fails (e.g. constraint), skip it
        console.warn(`[import-ofx] Skipping transaction ${txn.fitId}:`, insertError);
        skipped++;
      }
    }

    return NextResponse.json(
      {
        imported,
        skipped,
        total: parsed.transactions.length,
        accountId,
        accountName: resolvedAccountName,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[/api/transactions/import-ofx] Error:', error);
    return NextResponse.json(
      { error: `Internal server error: ${message}` },
      { status: 500 },
    );
  }
}
