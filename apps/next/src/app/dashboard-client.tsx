'use client';

import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn, formatBRL, formatDate } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface StatData {
  value: number;
  trend: number; // percentage diff vs last month
}

interface CategoryData {
  name: string;
  value: number;
  color: string;
}

interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: string; // numeric
  source: string;
}

interface DashboardClientProps {
  totalBalance: number;
  income: StatData;
  expenses: StatData;
  transactionsCount: StatData;
  categoryData: CategoryData[];
  recentTransactions: Transaction[];
}

const CATEGORY_COLORS: Record<string, string> = {
  comida: '#f97316',
  transporte: '#3b82f6',
  assinaturas: '#a855f7',
  lazer: '#ec4899',
  saude: '#ef4444',
  moradia: '#f59e0b',
  educacao: '#6366f1',
  investimento: '#10b981',
  desconhecido: '#64748b',
};

const categoryLabels: Record<string, string> = {
  comida: 'Alimentação',
  transporte: 'Transporte',
  assinaturas: 'Assinaturas',
  lazer: 'Lazer',
  saude: 'Saúde',
  moradia: 'Moradia',
  educacao: 'Educação',
  salario: 'Salário',
  investimento: 'Investimento',
  transferencia: 'Transferência',
  desconhecido: 'Outros',
};

const sourceColors: Record<string, string> = {
  pluggy: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  notification: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  ofx: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  uber: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  manual: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
};

/* ------------------------------------------------------------------ */
/*  Custom Recharts Tooltip                                            */
/* ------------------------------------------------------------------ */

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { color: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0];
  return (
    <div className="bg-slate-800/90 backdrop-blur-lg border border-slate-700/50 rounded-xl px-4 py-3 shadow-xl">
      <p className="text-xs text-slate-400 mb-1">{data.name}</p>
      <p className="text-sm font-semibold text-slate-50">{formatBRL(data.value)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DashboardClient({
  totalBalance,
  income,
  expenses,
  transactionsCount,
  categoryData,
  recentTransactions
}: DashboardClientProps) {
  
  const totalExpenses = categoryData.reduce((s, c) => s + c.value, 0);

  const stats = [
    {
      title: 'Saldo Total',
      value: totalBalance,
      icon: DollarSign,
      trend: 0, // Balance trend is more complex, leaving at 0 for now
      trendLabel: 'atual',
      isCurrency: true,
    },
    {
      title: 'Receitas (Mês)',
      value: income.value,
      icon: TrendingUp,
      trend: income.trend,
      trendLabel: 'vs mês anterior',
      isCurrency: true,
    },
    {
      title: 'Despesas (Mês)',
      value: expenses.value,
      icon: TrendingDown,
      trend: expenses.trend,
      trendLabel: 'vs mês anterior',
      isCurrency: true,
    },
    {
      title: 'Transações',
      value: transactionsCount.value,
      icon: Activity,
      trend: transactionsCount.trend,
      trendLabel: 'vs mês anterior',
      isCurrency: false,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-slate-50 sm:text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Visão geral das suas finanças</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <Card
            key={stat.title}
            className="hover:scale-[1.02] hover:shadow-emerald-500/10 hover:shadow-xl animate-fade-in-up group"
            style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'both' }}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-400">{stat.title}</span>
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center group-hover:from-emerald-500/30 group-hover:to-teal-500/30 transition-colors">
                  <stat.icon className="w-4.5 h-4.5 text-emerald-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-50 tracking-tight">
                {stat.isCurrency ? formatBRL(stat.value) : stat.value}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                {stat.trend > 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md">
                    <ArrowUpRight className="w-3 h-3" />
                    +{stat.trend.toFixed(1)}%
                  </span>
                ) : stat.trend < 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-xs font-medium text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-md">
                    <ArrowDownRight className="w-3 h-3" />
                    {stat.trend.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-md">
                    0%
                  </span>
                )}
                <span className="text-xs text-slate-500">{stat.trendLabel}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts + Transactions Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Category Donut */}
        <Card
          className="lg:col-span-2 animate-fade-in-up"
          style={{ animationDelay: '400ms', animationFillMode: 'both' }}
        >
          <CardHeader>
            <CardTitle className="text-base">Despesas por Categoria (Mês)</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryData.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-slate-500 text-sm">
                Sem despesas neste mês.
              </div>
            ) : (
              <>
                <div className="h-[240px] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {categoryData.map((entry, idx) => (
                          <Cell key={idx} fill={CATEGORY_COLORS[entry.name] || CATEGORY_COLORS['desconhecido']} className="transition-opacity hover:opacity-80" />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs text-slate-400">Total</span>
                    <span className="text-lg font-bold text-slate-50">{formatBRL(totalExpenses)}</span>
                  </div>
                </div>
                {/* Legend */}
                <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                  {categoryData.map((cat) => (
                    <div key={cat.name} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat.name] || CATEGORY_COLORS['desconhecido'] }} />
                      <span className="text-slate-400 truncate">{categoryLabels[cat.name] || cat.name}</span>
                      <span className="ml-auto text-slate-300 font-medium">{formatBRL(cat.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card
          className="lg:col-span-3 animate-fade-in-up"
          style={{ animationDelay: '500ms', animationFillMode: 'both' }}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Transações Recentes</CardTitle>
              <a href="/transactions" className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                Ver todas →
              </a>
            </div>
          </CardHeader>
          <CardContent>
            {recentTransactions.length === 0 ? (
               <div className="py-12 flex items-center justify-center text-slate-500 text-sm">
                 Nenhuma transação encontrada.
               </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Descrição</TableHead>
                    <TableHead className="text-xs">Categoria</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Fonte</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTransactions.map((tx) => (
                    <TableRow key={tx.id} className="group/row">
                      <TableCell className="text-xs text-slate-400 whitespace-nowrap">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-slate-200 max-w-[200px] truncate">
                        {tx.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tx.category as any} className="text-[10px]">
                          {categoryLabels[tx.category] ?? tx.category}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-xs font-semibold text-right whitespace-nowrap',
                          Number(tx.amount) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                        )}
                      >
                        {Number(tx.amount) >= 0 ? '+' : ''}
                        {formatBRL(Number(tx.amount))}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase',
                            sourceColors[tx.source] ?? 'bg-slate-800 text-slate-300 border-slate-700/50',
                          )}
                        >
                          {tx.source}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
