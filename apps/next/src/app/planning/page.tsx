import {
  db,
  recurrenceRules,
  recurrenceOccurrences,
  budgets,
  budgetCategories,
  categories,
  transactions,
  sql,
  eq,
  gte,
  lt,
  and,
} from '@ecofinance/db';
import {
  resolveMonthParam,
  monthBounds,
  currentMonthParam,
} from '@ecofinance/shared';
import PlanningClient, {
  type PlanningOccurrence,
  type PlanningBudgetCategory,
} from './planning-client';
import { requirePageUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams?: Promise<{ mes?: string }>;
}

export default async function PlanningPage({ searchParams }: PageProps) {
  const userId = await requirePageUser();
  const resolvedParams = searchParams ? await searchParams : {};
  const rawMonth = typeof resolvedParams.mes === 'string' ? resolvedParams.mes : null;

  const now = new Date();
  const resolved = resolveMonthParam(rawMonth, now);
  const bounds = monthBounds(resolved.month);

  const fallbackMonth = bounds ? resolved.month : currentMonthParam(now);
  const activeBounds = bounds ?? monthBounds(fallbackMonth)!;

  try {
    const startOfSelectedMonth = new Date(`${activeBounds.start}T00:00:00.000Z`);
    const startOfNextMonth = new Date(`${activeBounds.endExclusive}T00:00:00.000Z`);

    // 1. Recurrence Occurrences for this month
    let occurrences: PlanningOccurrence[] = [];
    try {
      const occResult = await db
        .select({
          id: recurrenceOccurrences.id,
          amount: recurrenceOccurrences.amount,
          dueDate: recurrenceOccurrences.dueDate,
          status: recurrenceOccurrences.status,
          description: recurrenceRules.description,
          dueDay: recurrenceRules.dueDay,
        })
        .from(recurrenceOccurrences)
        .innerJoin(recurrenceRules, eq(recurrenceOccurrences.ruleId, recurrenceRules.id))
        .where(and(eq(recurrenceOccurrences.ownerId, userId), eq(recurrenceOccurrences.competenceMonth, `${resolved.month}-01`)))
        .orderBy(recurrenceOccurrences.dueDate);

      occurrences = occResult.map((o) => ({
        id: o.id,
        description: o.description,
        amount: Math.abs(Number(o.amount)),
        dueDate: o.dueDate,
        status: o.status as 'pending' | 'paid' | 'postponed' | 'cancelled',
        dueDay: o.dueDay,
      }));
    } catch {
      occurrences = [];
    }

    // 2. Budget limits for this month
    let budgetTotal = 0;
    let expectedIncome = 0;
    let reserve = 0;
    let categoryBudgets: PlanningBudgetCategory[] = [];

    try {
      const budgetResult = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.ownerId, userId), eq(budgets.competenceMonth, `${resolved.month}-01`)))
        .limit(1);

      if (budgetResult.length > 0) {
        const b = budgetResult[0]!;
        budgetTotal = Number(b.limit || 0);
        expectedIncome = Number(b.expectedIncome || 0);
        reserve = Number(b.reserve || 0);

        const catResult = await db
          .select({
            id: budgetCategories.id,
            limit: budgetCategories.limit,
            categoryName: categories.name,
            legacyKey: categories.legacyKey,
          })
          .from(budgetCategories)
          .innerJoin(categories, eq(budgetCategories.categoryId, categories.id))
          .where(and(eq(budgetCategories.ownerId, userId), eq(budgetCategories.budgetId, b.id)));

        categoryBudgets = catResult.map((c) => ({
          id: c.id,
          categoryName: c.categoryName,
          categoryKey: c.legacyKey || c.categoryName.toLowerCase(),
          limit: Number(c.limit),
          spent: 0,
        }));
      }
    } catch {
      // Budgets not set up yet
    }

    // 3. Real spent by category in this month for comparison
    const spentResult = await db
      .select({
        name: transactions.category,
        spent: sql<string>`coalesce(sum(abs(${transactions.amount})), '0')`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.ownerId, userId),
          lt(transactions.amount, '0'),
          gte(transactions.date, startOfSelectedMonth),
          lt(transactions.date, startOfNextMonth),
        ),
      )
      .groupBy(transactions.category);

    const spentMap = new Map<string, number>();
    for (const row of spentResult) {
      spentMap.set(row.name, Number(row.spent));
    }

    const totalSpent = Array.from(spentMap.values()).reduce((sum, v) => sum + v, 0);

    return (
      <PlanningClient
        month={resolved.month}
        isCurrentMonth={resolved.isCurrent}
        occurrences={occurrences}
        budgetLimit={budgetTotal}
        expectedIncome={expectedIncome}
        reserve={reserve}
        totalSpent={totalSpent}
        categoryBudgets={categoryBudgets}
      />
    );
  } catch (error) {
    return (
      <PlanningClient
        month={resolved.month}
        isCurrentMonth={resolved.isCurrent}
        error={error instanceof Error ? error.message : 'Falha ao carregar planejamento.'}
        occurrences={[]}
        budgetLimit={0}
        expectedIncome={0}
        reserve={0}
        totalSpent={0}
        categoryBudgets={[]}
      />
    );
  }
}
