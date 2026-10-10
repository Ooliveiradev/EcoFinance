'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Activity,
  Plus,
  Upload,
  AlertTriangle,
  Inbox,
  ArrowRight,
  RefreshCw,
  BarChart3,
} from 'lucide-react';
import {
  monthLabel,
  formatBRL,
  formatCents,
  moneyToCents,
  TRANSACTION_CATEGORY_LABELS,
  type TransactionCategory,
  type TrendDescription,
  type DashboardCardId,
  type MonthProjection,
} from '@ecofinance/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn, formatDate } from '@/lib/utils';
import { usePreferences } from '@/lib/preferences-context';
import { MonthSelector } from '@/components/month-selector';
import { UpcomingBillsCard, type UpcomingBill } from '@/components/upcoming-bills-card';
import { AddExpenseModal } from '@/components/add-expense-modal';
import { PendingImportsNotice } from '@/components/pending-imports-notice';

const CategoryChart = dynamic(() => import('./category-chart'), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      className="h-[240px] flex items-center justify-center text-xs text-muted"
    >
      Carregando gráfico…
    </div>
  ),
});

export type UpcomingBillItem = UpcomingBill;

export interface CategoryData {
  id?: string;
  formatted?: string;
  /** Exact share from the metrics report (one decimal), the same value /reports shows. */
  share?: string;
  name: string;
  value: number;
  color: string;
}

export interface TransactionItem {
  categoryName?: string;
  id: string;
  date: string;
  description: string;
  category: TransactionCategory;
  amount: string;
  source: string;
}

interface DashboardMetrics {
  totalBalance: number;
  totalBalanceFormatted?: string;
  totalBalanceExact?: string|null;
  income: { value: number; formatted?: string; exact?: string; trend: TrendDescription };
  expenses: { value: number; formatted?: string; exact?: string; trend: TrendDescription };
  transactionsCount: { value: number; trend: TrendDescription };
  categoryData: CategoryData[];
  recentTransactions: TransactionItem[];
  upcomingBills?: UpcomingBillItem[];
  accounts?: Array<{ id: string; name: string }>;
  categories?: Array<{ id: string; name: string }>;
  projection?: MonthProjection;
  /** Import batches in review; their previews are never part of these numbers. */
  pendingImports?: number;
}
interface DashboardBase { month: string; isCurrentMonth: boolean; monthValid?: boolean }
/** A failed read carries no numbers, so the page cannot present zeros as real totals. */
export type DashboardClientProps = DashboardBase & ((DashboardMetrics & { error?: undefined }) | { error: string });

const CATEGORY_COLORS: Record<string, string> = {
  comida: '#f97316',
  transporte: '#3b82f6',
  assinaturas: '#a855f7',
  lazer: '#ec4899',
  saude: '#ef4444',
  moradia: '#f59e0b',
  educacao: '#6366f1',
  salario: '#10b981',
  investimento: '#06b6d4',
  transferencia: '#8b5cf6',
  desconhecido: '#64748b',
};

const SOURCE_BADGES: Record<string, { label: string; className: string }> = {
  pluggy: { label: 'Banco (Pluggy)', className: 'bg-info-soft text-info border-info/30' },
  notification: { label: 'Notificação', className: 'bg-success-soft text-success border-success/30' },
  ofx: { label: 'Arquivo OFX', className: 'bg-warning-soft text-warning border-warning/30' },
  uber: { label: 'Uber', className: 'bg-surface-muted text-muted border-border' },
  manual: { label: 'Manual', className: 'bg-surface-raised text-foreground border-border' },
  csv: { label: 'CSV', className: 'bg-warning-soft text-warning border-warning/30' },
};

const EMPTY_BILLS: UpcomingBillItem[] = [];
const EMPTY_ACCOUNTS: Array<{ id: string; name: string }> = [];

export default function DashboardClient(props: DashboardClientProps) {
  const { month, isCurrentMonth, monthValid = true, error } = props;
  const router = useRouter();
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const formattedMonth = monthLabel(month);
  const accounts = props.error === undefined ? props.accounts ?? EMPTY_ACCOUNTS : EMPTY_ACCOUNTS;
  const categories = props.error === undefined ? props.categories ?? EMPTY_ACCOUNTS : EMPTY_ACCOUNTS;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Real Error State Banner */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-danger-soft text-danger border border-danger/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Falha ao obter dados financeiros</p>
              <p className="text-xs opacity-90 mt-0.5">{error}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.refresh()}
            className="self-start sm:self-auto border-danger/30 hover:bg-danger/10 text-danger shrink-0 touch-target"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Invalid Month Query Warning */}
      {!monthValid && (
        <div
          role="status"
          className="p-3 rounded-xl bg-warning-soft text-warning border border-warning/20 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            O mês solicitado no endereço não foi reconhecido. Exibindo os lançamentos de{' '}
            <strong>{formattedMonth}</strong>.
          </span>
        </div>
      )}

      {/* Top Header with Month Navigator and Quick Actions */}
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              Meu mês
            </h1>
            {isCurrentMonth && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                Mês atual
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted capitalize">
            Visão consolidada de {formattedMonth}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <MonthSelector currentMonth={month} />

          <Button
            onClick={(event) => { event.currentTarget.focus(); setIsAddExpenseOpen(true); }}
            size="default"
            className="touch-target shadow-xs"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Adicionar gasto
          </Button>

          <Link
            href="/imports"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'default' }),
              'touch-target border-border text-foreground hover:bg-surface-muted',
            )}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Importar arquivo
          </Link>

          <Link
            href={`/reports?de=${month}&ate=${month}`}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'default' }),
              'touch-target border-border text-foreground hover:bg-surface-muted',
            )}
          >
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Relatórios
          </Link>
        </div>
      </header>

      {props.error === undefined && <PendingImportsNotice count={props.pendingImports ?? 0} />}

      {/* Dynamic Cards Rendered in User Preferred Order & Visibility */}
      {props.error === undefined && (
        <DashboardCards {...props} formattedMonth={formattedMonth} onAddExpense={() => setIsAddExpenseOpen(true)} />
      )}

      {/* Quick Add Expense Modal */}
      <AddExpenseModal
        isOpen={isAddExpenseOpen}
        onClose={() => setIsAddExpenseOpen(false)}
        onSuccess={() => router.refresh()}
        accounts={accounts}
        categories={categories}
      />
    </div>
  );
}

function DashboardCards({
  formattedMonth,
  onAddExpense,
  totalBalance,
  totalBalanceFormatted,
  income,
  expenses,
  transactionsCount,
  categoryData,
  recentTransactions,
  upcomingBills = EMPTY_BILLS,
  projection,
}: DashboardMetrics & { formattedMonth: string; onAddExpense: () => void }) {
  const { preferences } = usePreferences();
  const totalExpenses = expenses.value;

  // Determine card rendering order and visibility based on user preferences
  const activeCardIds: DashboardCardId[] = preferences.dashboardCards
    .filter((card) => card.visible)
    .map((card) => card.id);

  const stats = [
    {
      id: 'balance',
      title: 'Saldo Total',
      value: totalBalance,
      formatted: totalBalanceFormatted,
      icon: DollarSign,
      trend: null as TrendDescription | null,
      trendLabel: 'Consolidado de todas as contas',
      isCurrency: true,
    },
    {
      id: 'income',
      title: `Receitas (${formattedMonth})`,
      value: income.value,
      formatted: income.formatted,
      icon: TrendingUp,
      trend: income.trend,
      trendLabel: income.trend.label,
      isCurrency: true,
      trendColor:
        income.trend.direction === 'up'
          ? 'text-success bg-success-soft'
          : income.trend.direction === 'down'
          ? 'text-danger bg-danger-soft'
          : 'text-muted bg-surface-muted',
    },
    {
      id: 'expenses',
      title: `Despesas (${formattedMonth})`,
      value: expenses.value,
      formatted: expenses.formatted,
      icon: TrendingDown,
      trend: expenses.trend,
      trendLabel: expenses.trend.label,
      isCurrency: true,
      // For expenses: going down is good (green), going up is bad (red)
      trendColor:
        expenses.trend.direction === 'down'
          ? 'text-success bg-success-soft'
          : expenses.trend.direction === 'up'
          ? 'text-danger bg-danger-soft'
          : 'text-muted bg-surface-muted',
    },
    {
      id: 'count',
      title: `Lançamentos (${formattedMonth})`,
      value: transactionsCount.value,
      icon: Activity,
      trend: transactionsCount.trend,
      trendLabel: transactionsCount.trend.label,
      isCurrency: false,
      trendColor: 'text-foreground bg-surface-muted',
    },
  ];

  /* ------------------------------------------------------------------ */
  /*  Render Card Components                                            */
  /* ------------------------------------------------------------------ */

  const renderUpcomingBillsCard = () => (
    <section key="upcoming-bills" aria-labelledby="upcoming-bills-title">
      <UpcomingBillsCard bills={upcomingBills} />
    </section>
  );

  const renderMonthSummaryCard = () => <MonthSummaryCard stats={stats} projection={projection} />;
  const renderCategoriesCard = () => <CategoriesCard categoryData={categoryData} formattedMonth={formattedMonth} totalExpenses={totalExpenses} formattedTotal={expenses.formatted} />;
  const renderRecentEntriesCard = () => <RecentEntriesCard recentTransactions={recentTransactions} formattedMonth={formattedMonth} onAddExpense={onAddExpense} />;
  /* ------------------------------------------------------------------ */
  /*  Card Map for Dynamic Ordering                                     */
  /* ------------------------------------------------------------------ */

  const cardRenderer: Record<DashboardCardId, () => React.JSX.Element> = {
    'upcoming-bills': renderUpcomingBillsCard,
    'month-summary': renderMonthSummaryCard,
    categories: renderCategoriesCard,
    'recent-entries': renderRecentEntriesCard,
  };

  return (
    <div className="space-y-6">
      {activeCardIds.map((cardId) => {
        const renderer = cardRenderer[cardId];
        return renderer ? <React.Fragment key={cardId}>{renderer()}</React.Fragment> : null;
      })}
    </div>
  );
}

interface DashboardStat { formatted?: string; id: string; title: string; value: number; icon: React.ComponentType<{className?: string}>; trend: TrendDescription | null; trendLabel: string; isCurrency: boolean; trendColor?: string; }
function MonthSummaryCard({ stats, projection }: { stats: DashboardStat[]; projection?: MonthProjection }) {
  return (
    <section key="month-summary" aria-labelledby="month-summary-title">
      <h2 id="month-summary-title" className="sr-only">
        Resumo financeiro do mês
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.id}
              className="hover:scale-[1.01] hover:shadow-lg transition-transform"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'both' }}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {stat.title}
                  </span>
                  <div
                    className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <p className="text-2xl font-bold text-foreground tracking-tight">
                  {stat.isCurrency ? (stat.formatted ?? formatBRL(stat.value)) : stat.value}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  {stat.trend && stat.trend.direction !== 'unknown' ? (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md',
                        stat.trendColor,
                      )}
                      aria-label={stat.trend.label}
                    >
                      {stat.trend.direction === 'up' && <ArrowUpRight className="w-3.5 h-3.5" />}
                      {stat.trend.direction === 'down' && <ArrowDownRight className="w-3.5 h-3.5" />}
                      {stat.trend.direction === 'flat' && <Minus className="w-3.5 h-3.5" />}
                      <span>{stat.trend.short}</span>
                    </span>
                  ) : stat.trend ? (
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted bg-surface-muted px-2 py-0.5 rounded-md"
                      aria-label="Sem mês anterior para comparação"
                    >
                      <Minus className="w-3.5 h-3.5" />
                      <span>Sem base anterior</span>
                    </span>
                  ) : null}

                  <span className="text-xs text-muted truncate" title={stat.trendLabel}>
                    {stat.trend ? 'vs mês anterior' : stat.trendLabel}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {projection && <ProjectionCard projection={projection} />}
    </section>
  );
}

const cents = (value: string) => formatCents(moneyToCents(value));
/** Shows every term of the projected availability, so the result can be checked by hand. */
function ProjectionCard({ projection }: { projection: MonthProjection }) {
  const rows: Array<[string, string, string]> = [
    ['Receita recebida', cents(projection.received), 'Receitas registradas na competência'],
    ['Receita prevista', projection.expectedIncome === null ? 'Sem orçamento' : cents(projection.expectedIncome), 'Renda prevista no planejamento'],
    ['Despesas realizadas', cents(projection.realized), 'Despesas menos estornos da competência'],
    ['Compromissos restantes', cents(projection.commitments.total), `Recorrências ${cents(projection.commitments.recurring)} · previstos ${cents(projection.commitments.planned)} · faturas ${cents(projection.commitments.invoices)}`],
  ];
  return (
    <Card className="mt-4" aria-labelledby="projection-title">
      <CardHeader className="pb-2">
        <CardTitle id="projection-title" className="text-base font-bold text-foreground">Disponibilidade projetada</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {rows.map(([label, value, hint]) => (
            <div key={label} className="rounded-xl border border-border p-3">
              <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
              <dd className="text-lg font-bold text-foreground">{value}</dd>
              <dd className="text-xs text-muted">{hint}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-foreground" data-testid="projection-formula">
          <span className="font-semibold">Fórmula: </span>
          saldo atual {projection.balance === null ? 'indisponível' : cents(projection.balance)}
          {' + '}a receber {projection.toReceive === null ? 'R$ 0,00 (sem orçamento)' : cents(projection.toReceive)}
          {' − '}compromissos {cents(projection.commitments.total)}
          {' = '}<strong>{projection.projected === null ? 'indisponível' : cents(projection.projected)}</strong>
        </p>
      </CardContent>
    </Card>
  );
}

function CategoriesCard({ categoryData, formattedMonth, totalExpenses, formattedTotal }: { categoryData: CategoryData[]; formattedMonth: string; totalExpenses: number; formattedTotal?: string }) {
  return (
    <section key="categories" aria-labelledby="categories-chart-title">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle id="categories-chart-title" className="text-base font-bold text-foreground">
              Despesas por Categoria
            </CardTitle>
            <p className="text-xs text-muted mt-0.5">Distribuição dos gastos em {formattedMonth}</p>
          </div>
          {categoryData.length > 0 && (
            <Badge variant="outline" className="text-xs font-semibold">
              Total: {formattedTotal ?? formatBRL(totalExpenses)}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {categoryData.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-surface-muted text-muted flex items-center justify-center mb-3">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Nenhuma despesa categorizada neste mês
              </p>
              <p className="text-xs text-muted max-w-sm mt-1">
                Lançamentos cadastrados com categorias aparecerão aqui para ajudar na sua gestão de orçamento.
              </p>
            </div>
          ) : (
            <>
              {/* Donut Chart with Centered Total */}
              <div className="h-[240px] relative">
                <CategoryChart data={categoryData} colors={CATEGORY_COLORS} />
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none"
                  aria-hidden="true"
                >
                  <span className="text-xs font-semibold text-muted uppercase tracking-wider">
                    Total
                  </span>
                  <span className="text-lg font-bold text-foreground">
                    {formattedTotal ?? formatBRL(totalExpenses)}
                  </span>
                </div>
              </div>

              {/* Accessible Summary Data Table underneath */}
              <div className="pt-2 border-t border-border">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Tabela resumo de categorias ({formattedMonth})
                </h3>
                <div className="overflow-x-auto">
                  <Table>
                    <caption className="sr-only">
                      Detalhamento de despesas por categoria de {formattedMonth}
                    </caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Categoria</TableHead>
                        <TableHead className="text-xs text-right">Valor</TableHead>
                        <TableHead className="text-xs text-right">Participação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryData.map((cat) => {
                        const pct = cat.share ?? (totalExpenses > 0 ? ((cat.value / totalExpenses) * 100).toFixed(1) : '0.0');
                        const label = cat.id ? cat.name : TRANSACTION_CATEGORY_LABELS[cat.name as TransactionCategory] ?? cat.name;
                        const color = cat.color || CATEGORY_COLORS[cat.name] || CATEGORY_COLORS.desconhecido;

                        return (
                          <TableRow key={cat.id ?? cat.name}>
                            <TableCell className="text-xs font-medium text-foreground">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                  aria-hidden="true"
                                />
                                <span>{label}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs font-semibold text-foreground text-right">
                              {cat.formatted ?? formatBRL(cat.value)}
                            </TableCell>
                            <TableCell className="text-xs text-muted text-right">
                              {pct.replace('.', ',')}%
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );


}

function RecentEntriesCard({ recentTransactions, formattedMonth, onAddExpense }: { recentTransactions: TransactionItem[]; formattedMonth: string; onAddExpense: () => void }) {
  return (
    <section key="recent-entries" aria-labelledby="recent-entries-title">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle id="recent-entries-title" className="text-base font-bold text-foreground">
              Lançamentos do Mês
            </CardTitle>
            <p className="text-xs text-muted mt-0.5">Últimas transações em {formattedMonth}</p>
          </div>
          <Link
            href="/transactions"
            className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1 transition-colors"
          >
            Ver todos
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </CardHeader>

        <CardContent>
          {recentTransactions.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-surface-muted text-muted flex items-center justify-center mb-3">
                <Inbox className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Nenhum lançamento em {formattedMonth}
              </p>
              <p className="text-xs text-muted max-w-sm mt-1 mb-4">
                Registre seus gastos ou importe um extrato bancário para começar a acompanhar o mês.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={(event) => { event.currentTarget.focus(); onAddExpense(); }}
                  className="touch-target"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  Adicionar gasto
                </Button>
                <Link
                  href="/imports"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'touch-target')}
                >
                  <Upload className="w-4 h-4 mr-1.5" />
                  Importar arquivo
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Descrição</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Origem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTransactions.map((tx) => {
                    const isPositive = Number(tx.amount) >= 0;
                    const catLabel = tx.categoryName ?? TRANSACTION_CATEGORY_LABELS[tx.category] ?? tx.category;
                    const sourceInfo = SOURCE_BADGES[tx.source] ?? {
                      label: tx.source,
                      className: 'bg-surface-muted text-muted border-border',
                    };

                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs text-muted whitespace-nowrap">
                          {formatDate(tx.date)}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-foreground max-w-[220px] truncate">
                          {tx.description}
                        </TableCell>
                        <TableCell>
                          <Badge variant={tx.category} className="text-[10px]">
                            {catLabel}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-xs font-bold text-right whitespace-nowrap',
                            isPositive ? 'text-success' : 'text-danger',
                          )}
                        >
                          {isPositive ? '+' : ''}
                          {formatCents(moneyToCents(tx.amount))}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium',
                              sourceInfo.className,
                            )}
                          >
                            {sourceInfo.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
