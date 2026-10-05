import { db, accounts, transactions, recurrenceOccurrences, recurrenceRules, invoices, cards, sql, desc, gte, lt, and, eq, } from '@ecofinance/db';
import { resolveMonthParam, monthBounds, shiftMonth, percentChange, describeTrend, type TransactionCategory, } from '@ecofinance/shared';
import type { DashboardClientProps, UpcomingBillItem } from '@/app/dashboard-client';
export async function loadDashboardData(userId: string, resolved: ReturnType<typeof resolveMonthParam>, bounds: NonNullable<ReturnType<typeof monthBounds>>): Promise<DashboardClientProps> {
    try {
        const startOfSelectedMonth = new Date(`${bounds.start}T00:00:00.000Z`);
        const startOfNextMonth = new Date(`${bounds.endExclusive}T00:00:00.000Z`);
        const prevMonth = shiftMonth(resolved.month, -1);
        const prevBounds = prevMonth ? monthBounds(prevMonth) : null;
        const startOfLastMonth = prevBounds ? new Date(`${prevBounds.start}T00:00:00.000Z`) : null;
        const startOfThisMonthForTrend = prevBounds ? new Date(`${prevBounds.endExclusive}T00:00:00.000Z`) : null;
        // 1. Total Balance across all accounts
        const balanceResult = await db
            .select({ total: sql<string> `coalesce(sum(${accounts.balance}), '0')` })
            .from(accounts).where(eq(accounts.ownerId, userId));
        const totalBalance = Number(balanceResult[0]?.total || 0);
        // 2. Selected Month Stats (Income, Expenses, Count)
        const currentMonthStats = await db
            .select({
            income: sql<string> `coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), '0')`,
            expenses: sql<string> `coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), '0')`,
            count: sql<number> `count(*)`,
        })
            .from(transactions)
            .where(and(eq(transactions.ownerId, userId), gte(transactions.date, startOfSelectedMonth), lt(transactions.date, startOfNextMonth)));
        const curIncome = Number(currentMonthStats[0]?.income || 0);
        const curExpenses = Math.abs(Number(currentMonthStats[0]?.expenses || 0));
        const curCount = Number(currentMonthStats[0]?.count || 0);
        // 3. Last Month Stats (for baseline comparison)
        let lastIncome = 0;
        let lastExpenses = 0;
        let lastCount = 0;
        let hasLastMonthBaseline = false;
        if (startOfLastMonth && startOfThisMonthForTrend) {
            const lastMonthStats = await db
                .select({
                income: sql<string> `coalesce(sum(case when ${transactions.amount} > 0 then ${transactions.amount} else 0 end), '0')`,
                expenses: sql<string> `coalesce(sum(case when ${transactions.amount} < 0 then ${transactions.amount} else 0 end), '0')`,
                count: sql<number> `count(*)`,
            })
                .from(transactions)
                .where(and(eq(transactions.ownerId, userId), gte(transactions.date, startOfLastMonth), lt(transactions.date, startOfThisMonthForTrend)));
            lastIncome = Number(lastMonthStats[0]?.income || 0);
            lastExpenses = Math.abs(Number(lastMonthStats[0]?.expenses || 0));
            lastCount = Number(lastMonthStats[0]?.count || 0);
            hasLastMonthBaseline = lastCount > 0 || lastIncome > 0 || lastExpenses > 0;
        }
        // Explicit trends without invented fake percentages
        const incomeTrend = describeTrend(hasLastMonthBaseline ? percentChange(curIncome, lastIncome) : null);
        const expensesTrend = describeTrend(hasLastMonthBaseline ? percentChange(curExpenses, lastExpenses) : null);
        const countTrend = describeTrend(hasLastMonthBaseline ? percentChange(curCount, lastCount) : null);
        // 4. Category Data for PieChart / Donut (Selected Month Expenses)
        const categoryResult = await db
            .select({
            name: transactions.category,
            value: sql<string> `coalesce(sum(abs(${transactions.amount})), '0')`,
        })
            .from(transactions)
            .where(and(eq(transactions.ownerId, userId), lt(transactions.amount, '0'), gte(transactions.date, startOfSelectedMonth), lt(transactions.date, startOfNextMonth)))
            .groupBy(transactions.category);
        const categoryData = categoryResult
            .map((c) => ({
            name: c.name,
            value: Math.abs(Number(c.value)),
            color: '',
        }))
            .filter((c) => c.value > 0);
        // 5. Recent Transactions in the month
        const recentTx = await db
            .select()
            .from(transactions)
            .where(and(eq(transactions.ownerId, userId), gte(transactions.date, startOfSelectedMonth), lt(transactions.date, startOfNextMonth)))
            .orderBy(desc(transactions.date))
            .limit(10);
        const serializedTx = recentTx.map((tx) => ({
            id: tx.id,
            date: tx.date.toISOString(),
            description: tx.description,
            category: tx.category as TransactionCategory,
            amount: tx.amount,
            source: tx.source,
        }));
        // 6. Upcoming Bills (recurrence occurrences and invoices)
        let upcomingBills: UpcomingBillItem[] = [];
        try {
            const occurrencesResult = await db
                .select({
                id: recurrenceOccurrences.id,
                amount: recurrenceOccurrences.amount,
                dueDate: recurrenceOccurrences.dueDate,
                status: recurrenceOccurrences.status,
                description: recurrenceRules.description,
            })
                .from(recurrenceOccurrences)
                .innerJoin(recurrenceRules, eq(recurrenceOccurrences.ruleId, recurrenceRules.id))
                .where(and(eq(recurrenceOccurrences.ownerId, userId), eq(recurrenceOccurrences.competenceMonth, `${resolved.month}-01`)))
                .orderBy(recurrenceOccurrences.dueDate);
            const invoiceResult = await db
                .select({
                id: invoices.id,
                statedTotal: invoices.statedTotal,
                dueDate: invoices.dueDate,
                status: invoices.status,
                cardName: cards.name,
            })
                .from(invoices)
                .innerJoin(cards, eq(invoices.cardId, cards.id))
                .where(and(eq(invoices.ownerId, userId), eq(invoices.competenceMonth, `${resolved.month}-01`)));
            upcomingBills = [
                ...occurrencesResult.map((b) => ({
                    id: b.id,
                    description: b.description,
                    amount: Math.abs(Number(b.amount)),
                    dueDate: b.dueDate,
                    category: 'Recorrente',
                    isPaid: b.status === 'paid',
                })),
                ...invoiceResult.map((inv) => ({
                    id: inv.id,
                    description: `Fatura ${inv.cardName}`,
                    amount: Math.abs(Number(inv.statedTotal || 0)),
                    dueDate: inv.dueDate,
                    category: 'Cartão de crédito',
                    isPaid: inv.status === 'paid',
                })),
            ];
        }
        catch {
            // If relations are not seeded yet, default to empty list
            upcomingBills = [];
        }
        // 7. Active Accounts for Quick Expense Entry
        let accountList: Array<{
            id: string;
            name: string;
        }> = [];
        try {
            accountList = await db
                .select({
                id: accounts.id,
                name: accounts.name,
            })
                .from(accounts)
                .where(eq(accounts.ownerId, userId))
                .orderBy(accounts.name);
        }
        catch {
            accountList = [];
        }
        return ({
            month: resolved.month,
            isCurrentMonth: resolved.isCurrent,
            monthValid: resolved.valid,
            totalBalance: totalBalance,
            income: { value: curIncome, trend: incomeTrend },
            expenses: { value: curExpenses, trend: expensesTrend },
            transactionsCount: { value: curCount, trend: countTrend },
            categoryData: categoryData,
            recentTransactions: serializedTx,
            upcomingBills: upcomingBills,
            accounts: accountList
        });
    }
    catch {
        // Graceful degradation when database connection fails or tables are uninitialized
        return ({
            month: resolved.month,
            isCurrentMonth: resolved.isCurrent,
            monthValid: resolved.valid,
            error: "Não foi possível carregar os dados financeiros do banco de dados.",
            totalBalance: 0,
            income: { value: 0, trend: describeTrend(null) },
            expenses: { value: 0, trend: describeTrend(null) },
            transactionsCount: { value: 0, trend: describeTrend(null) },
            categoryData: [],
            recentTransactions: [],
            upcomingBills: [],
            accounts: []
        });
    }
}
