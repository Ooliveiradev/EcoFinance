import { db, accounts, transactions, sql, desc, gte, lt, and } from '@ecofinance/db';
import DashboardClient from './dashboard-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Empty state returned when the database is not yet available
const EMPTY_STATE = {
  totalBalance: 0,
  income: { value: 0, trend: 0 },
  expenses: { value: 0, trend: 0 },
  transactionsCount: { value: 0, trend: 0 },
  categoryData: [] as { name: string; value: number; color: string }[],
  recentTransactions: [] as { id: string; date: string; description: string; category: string; amount: string; source: string }[],
};

export default async function DashboardPage() {
  try {
    const now = new Date();

    // Define current month boundaries
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Define last month boundaries for trend calculations
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfThisMonthForTrend = new Date(now.getFullYear(), now.getMonth(), 1);

    // 1. Total Balance
    const balanceResult = await db
      .select({ total: sql<string>`sum(${accounts.balance})` })
      .from(accounts);
    const totalBalance = Number(balanceResult[0]?.total || 0);

    // 2. Current Month Stats (Income, Expenses, Count)
    const currentMonthStats = await db
      .select({
        income: sql<string>`sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end)`,
        expenses: sql<string>`sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.date, startOfCurrentMonth),
          lt(transactions.date, startOfNextMonth),
        ),
      );

    const curIncome = Number(currentMonthStats[0]?.income || 0);
    const curExpenses = Math.abs(Number(currentMonthStats[0]?.expenses || 0));
    const curCount = Number(currentMonthStats[0]?.count || 0);

    // 3. Last Month Stats (Income, Expenses, Count)
    const lastMonthStats = await db
      .select({
        income: sql<string>`sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end)`,
        expenses: sql<string>`sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.date, startOfLastMonth),
          lt(transactions.date, startOfThisMonthForTrend),
        ),
      );

    const lastIncome = Number(lastMonthStats[0]?.income || 0);
    const lastExpenses = Math.abs(Number(lastMonthStats[0]?.expenses || 0));
    const lastCount = Number(lastMonthStats[0]?.count || 0);

    // Calculate Trends
    const calcTrend = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return ((curr - prev) / prev) * 100;
    };

    const incomeTrend = calcTrend(curIncome, lastIncome);
    const expensesTrend = calcTrend(curExpenses, lastExpenses);
    const countTrend = calcTrend(curCount, lastCount);

    // 4. Category Data for PieChart (Current Month Expenses)
    const categoryResult = await db
      .select({
        name: transactions.category,
        value: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(
        and(
          lt(transactions.amount, '0'), // Only expenses
          gte(transactions.date, startOfCurrentMonth),
          lt(transactions.date, startOfNextMonth),
        ),
      )
      .groupBy(transactions.category);

    const categoryData = categoryResult
      .map((c) => ({
        name: c.name,
        value: Math.abs(Number(c.value)),
        color: '', // Handled by client mapping
      }))
      .filter((c) => c.value > 0);

    // 5. Recent Transactions
    const recentTx = await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.date))
      .limit(10);

    const serializedTx = recentTx.map((tx) => ({
      ...tx,
      date: tx.date.toISOString(),
    }));

    return (
      <DashboardClient
        totalBalance={totalBalance}
        income={{ value: curIncome, trend: incomeTrend }}
        expenses={{ value: curExpenses, trend: expensesTrend }}
        transactionsCount={{ value: curCount, trend: countTrend }}
        categoryData={categoryData}
        recentTransactions={serializedTx}
      />
    );
  } catch {
    // Graceful degradation: render empty dashboard if DB is not yet configured.
    // Run `pnpm db:push` and restart the server to fix this.
    return <DashboardClient {...EMPTY_STATE} />;
  }
}
