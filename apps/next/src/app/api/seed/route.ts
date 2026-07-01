// =============================================================================
// Seed — POST /api/seed
// =============================================================================
// Populates the database with realistic demo data so anyone can see the
// dashboard working without a real bank account.
//
// ⚠️  Only available in development (NODE_ENV !== 'production').
// =============================================================================

import { db, accounts, transactions } from '@ecofinance/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Guard: never run in production
// ---------------------------------------------------------------------------
const isProduction = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const DEMO_ACCOUNTS = [
  {
    name: 'Nubank Conta Corrente',
    type: 'banco' as const,
    balance: '8450.00',
    pluggyItemId: null,
    pluggyAccountId: null,
  },
  {
    name: 'Nubank Cartão de Crédito',
    type: 'banco' as const,
    balance: '4000.00',
    pluggyItemId: null,
    pluggyAccountId: null,
  },
] as const;

// Transactions will be generated relative to today
function buildTransactions(accountId: string, creditCardId: string) {
  const now = new Date();
  const d = (daysAgo: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(Math.floor(Math.random() * 14) + 8, Math.floor(Math.random() * 60));
    return date;
  };

  return [
    // ── Receitas ──────────────────────────────────────────────────────────
    { accountId, description: 'Salário Empresa XYZ', amount: '5200.00', date: d(2), category: 'salario' as const, source: 'pluggy' as const },
    { accountId, description: 'Freelance Design', amount: '1200.00', date: d(8), category: 'salario' as const, source: 'pluggy' as const },
    { accountId, description: 'Dividendos Fundo Imobiliário', amount: '180.50', date: d(3), category: 'investimento' as const, source: 'pluggy' as const },

    // ── Alimentação ────────────────────────────────────────────────────────
    { accountId: creditCardId, description: 'iFood - Pizza ao Molho', amount: '-52.90', date: d(1), category: 'comida' as const, source: 'notification' as const, latitude: -23.5505, longitude: -46.6333 },
    { accountId: creditCardId, description: 'Mercado Livre - Hortifruti', amount: '-89.40', date: d(3), category: 'comida' as const, source: 'pluggy' as const },
    { accountId: creditCardId, description: 'McDonald\'s - Shopping', amount: '-43.70', date: d(5), category: 'comida' as const, source: 'notification' as const, latitude: -23.5613, longitude: -46.6559 },
    { accountId: creditCardId, description: 'Padaria Pão Dourado', amount: '-18.50', date: d(7), category: 'comida' as const, source: 'notification' as const },
    { accountId: creditCardId, description: 'iFood - Sushi Delivery', amount: '-78.00', date: d(12), category: 'comida' as const, source: 'notification' as const, latitude: -23.5480, longitude: -46.6388 },
    { accountId: creditCardId, description: 'Supermercado Extra', amount: '-213.60', date: d(15), category: 'comida' as const, source: 'ofx' as const },
    { accountId: creditCardId, description: 'Restaurante Japonês Sakura', amount: '-95.00', date: d(18), category: 'comida' as const, source: 'notification' as const, latitude: -23.5545, longitude: -46.6448 },

    // ── Transporte ────────────────────────────────────────────────────────
    { accountId: creditCardId, description: 'Uber - Av. Paulista → Pinheiros', amount: '-24.50', date: d(1), category: 'transporte' as const, source: 'uber' as const, latitude: -23.5629, longitude: -46.6544 },
    { accountId: creditCardId, description: 'Uber - Centro → Vila Madalena', amount: '-31.80', date: d(4), category: 'transporte' as const, source: 'uber' as const, latitude: -23.5575, longitude: -46.6969 },
    { accountId: creditCardId, description: 'Uber - Moema → Berrini', amount: '-19.90', date: d(9), category: 'transporte' as const, source: 'uber' as const, latitude: -23.5989, longitude: -46.6862 },
    { accountId: creditCardId, description: 'Shell - Combustível', amount: '-180.00', date: d(10), category: 'transporte' as const, source: 'ofx' as const },
    { accountId: creditCardId, description: 'Estacionamento Shopping Iguatemi', amount: '-22.00', date: d(14), category: 'transporte' as const, source: 'notification' as const },

    // ── Assinaturas ───────────────────────────────────────────────────────
    { accountId: creditCardId, description: 'Netflix Premium', amount: '-55.90', date: d(5), category: 'assinaturas' as const, source: 'pluggy' as const },
    { accountId: creditCardId, description: 'Spotify Família', amount: '-34.90', date: d(5), category: 'assinaturas' as const, source: 'pluggy' as const },
    { accountId: creditCardId, description: 'Adobe Creative Cloud', amount: '-259.00', date: d(6), category: 'assinaturas' as const, source: 'pluggy' as const },
    { accountId: creditCardId, description: 'GitHub Copilot', amount: '-55.90', date: d(7), category: 'assinaturas' as const, source: 'pluggy' as const },
    { accountId: creditCardId, description: 'ChatGPT Plus', amount: '-103.00', date: d(8), category: 'assinaturas' as const, source: 'pluggy' as const },

    // ── Lazer ─────────────────────────────────────────────────────────────
    { accountId: creditCardId, description: 'Ingresso Cinema Kinoplex', amount: '-42.00', date: d(11), category: 'lazer' as const, source: 'notification' as const },
    { accountId: creditCardId, description: 'Steam - Elden Ring DLC', amount: '-79.99', date: d(13), category: 'lazer' as const, source: 'notification' as const },
    { accountId: creditCardId, description: 'Bar do Zé - Happy Hour', amount: '-68.00', date: d(16), category: 'lazer' as const, source: 'notification' as const },

    // ── Saúde ─────────────────────────────────────────────────────────────
    { accountId: creditCardId, description: 'Farmácia São João', amount: '-87.50', date: d(6), category: 'saude' as const, source: 'notification' as const },
    { accountId: creditCardId, description: 'Consulta Médica - Dr. Silva', amount: '-280.00', date: d(20), category: 'saude' as const, source: 'ofx' as const },
    { accountId: creditCardId, description: 'Academia Smart Fit', amount: '-109.90', date: d(5), category: 'saude' as const, source: 'pluggy' as const },

    // ── Moradia ───────────────────────────────────────────────────────────
    { accountId, description: 'Aluguel Apartamento', amount: '-2200.00', date: d(1), category: 'moradia' as const, source: 'ofx' as const },
    { accountId, description: 'Conta de Luz ENEL', amount: '-187.30', date: d(8), category: 'moradia' as const, source: 'ofx' as const },
    { accountId, description: 'Internet Vivo Fibra', amount: '-99.90', date: d(8), category: 'moradia' as const, source: 'pluggy' as const },
    { accountId, description: 'Condomínio', amount: '-650.00', date: d(5), category: 'moradia' as const, source: 'ofx' as const },

    // ── Educação ──────────────────────────────────────────────────────────
    { accountId: creditCardId, description: 'Udemy - Curso TypeScript Avançado', amount: '-69.90', date: d(22), category: 'educacao' as const, source: 'notification' as const },
    { accountId: creditCardId, description: 'Rocketseat Pro', amount: '-249.90', date: d(25), category: 'educacao' as const, source: 'pluggy' as const },

    // ── Investimento ──────────────────────────────────────────────────────
    { accountId, description: 'Aporte CDB Nubank 110% CDI', amount: '-500.00', date: d(4), category: 'investimento' as const, source: 'pluggy' as const },
    { accountId, description: 'Tesouro Direto IPCA+', amount: '-300.00', date: d(4), category: 'investimento' as const, source: 'pluggy' as const },
  ] as const;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST() {
  if (isProduction) {
    return Response.json(
      { error: 'Seed is not available in production.' },
      { status: 403 },
    );
  }

  try {
    // 1. Clear existing data in correct order (FK constraint)
    await db.delete(transactions);
    await db.delete(accounts);

    // 2. Insert accounts
    const inserted = await db
      .insert(accounts)
      .values(DEMO_ACCOUNTS.map((a) => ({ ...a })))
      .returning({ id: accounts.id, name: accounts.name });

    const checkingAccount = inserted.find((a) => a.name.includes('Conta Corrente'))!;
    const creditCard = inserted.find((a) => a.name.includes('Cartão'))!;

    // 3. Insert transactions
    const txData = buildTransactions(checkingAccount.id, creditCard.id);

    await db.insert(transactions).values(
      txData.map((tx) => ({
        accountId: tx.accountId,
        description: tx.description,
        amount: tx.amount,
        date: tx.date,
        category: tx.category,
        source: tx.source,
        latitude: 'latitude' in tx ? (tx as any).latitude : null,
        longitude: 'longitude' in tx ? (tx as any).longitude : null,
      })),
    );

    return Response.json({
      success: true,
      message: `Seed concluído! ${inserted.length} contas e ${txData.length} transações criadas.`,
      accounts: inserted.map((a) => a.name),
      transactionsCount: txData.length,
    });
  } catch (error) {
    console.error('[seed] Error:', error);
    return Response.json(
      { error: 'Failed to seed database.', details: String(error) },
      { status: 500 },
    );
  }
}
