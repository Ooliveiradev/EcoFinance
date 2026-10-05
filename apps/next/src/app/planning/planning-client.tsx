'use client';

import React from 'react';
import {
  DollarSign,
  TrendingDown,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import Link from 'next/link';
import {
  monthLabel,
  formatBRL,
  civilToday,
  describeDue,
} from '@ecofinance/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { MonthSelector } from '@/components/month-selector';

export interface PlanningOccurrence {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'postponed' | 'cancelled';
  dueDay: number;
}

export interface PlanningBudgetCategory {
  id: string;
  categoryName: string;
  categoryKey: string;
  limit: number;
  spent: number;
}

export interface PlanningClientProps {
  month: string;
  isCurrentMonth: boolean;
  error?: string;
  occurrences: PlanningOccurrence[];
  budgetLimit: number;
  expectedIncome: number;
  reserve: number;
  totalSpent: number;
  categoryBudgets: PlanningBudgetCategory[];
}

export default function PlanningClient({
  month,
  isCurrentMonth,
  error,
  occurrences,
  budgetLimit,
  expectedIncome,
  reserve,
  totalSpent,
  categoryBudgets,
}: PlanningClientProps) {
  const formattedMonth = monthLabel(month);
  const today = civilToday(new Date());

  const remainingBudget = Math.max(0, budgetLimit - totalSpent);
  const budgetUsagePercent = budgetLimit > 0 ? Math.min(100, (totalSpent / budgetLimit) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
              Planejamento
            </h1>
            {isCurrentMonth && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                Mês atual
              </Badge>
            )}
            <Badge
              variant="outline"
              className="bg-info-soft text-info border-info/20 text-xs font-semibold"
            >
              Orçamento & Recorrentes
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted capitalize">
            Metas e compromissos financeiros de {formattedMonth}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <MonthSelector currentMonth={month} />
          <Link
            href="/"
            className={cn(buttonVariants({ variant: 'outline', size: 'default' }), 'touch-target')}
          >
            Voltar ao Meu mês
          </Link>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-danger-soft text-danger border border-danger/20 text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Info Prototype Callout */}
      <div className="p-4 rounded-2xl bg-surface-muted border border-border flex items-start gap-3">
        <Info className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-muted leading-relaxed">
          <p className="font-semibold text-foreground text-sm mb-1">
            Planejamento por competência mensal
          </p>
          O módulo de planejamento consolida o teto orçado por categoria e as contas fixas
          recorrentes programadas para a competência de <strong>{formattedMonth}</strong>.
        </div>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="hover:scale-[1.01] transition-transform">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Teto Orçado
              </span>
              <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {budgetLimit > 0 ? formatBRL(budgetLimit) : 'Não definido'}
            </p>
            <p className="mt-2 text-xs text-muted">
              {budgetLimit > 0 ? 'Limite total para o mês' : 'Defina um teto mensal'}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:scale-[1.01] transition-transform">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Total Realizado
              </span>
              <div className="w-9 h-9 rounded-xl bg-danger-soft text-danger flex items-center justify-center">
                <TrendingDown className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{formatBRL(totalSpent)}</p>
            <p className="mt-2 text-xs text-muted">
              {budgetLimit > 0
                ? `${budgetUsagePercent.toFixed(1).replace('.', ',')}% do orçamento utilizado`
                : 'Despesas acumuladas no mês'}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:scale-[1.01] transition-transform">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Saldo Disponível
              </span>
              <div className="w-9 h-9 rounded-xl bg-success-soft text-success flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {budgetLimit > 0 ? formatBRL(remainingBudget) : formatBRL(Math.max(0, expectedIncome - totalSpent))}
            </p>
            <p className="mt-2 text-xs text-muted">
              {budgetLimit > 0 ? 'Margem restante do teto' : 'Com base na renda esperada'}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:scale-[1.01] transition-transform">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Reserva Planejada
              </span>
              <div className="w-9 h-9 rounded-xl bg-info-soft text-info flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{formatBRL(reserve)}</p>
            <p className="mt-2 text-xs text-muted">Meta de economia / reserva</p>
          </CardContent>
        </Card>
      </div>

      {/* Recurring Bills Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-foreground">
              Compromissos Recorrentes
            </CardTitle>
            <p className="text-xs text-muted mt-0.5">
              Contas fixas e despesas programadas com vencimento em {formattedMonth}
            </p>
          </div>
          {occurrences.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {occurrences.length} {occurrences.length === 1 ? 'conta' : 'contas'}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {occurrences.length === 0 ? (
            <div className="py-10 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-surface-muted text-muted flex items-center justify-center mb-3">
                <Clock className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">
                Nenhuma conta recorrente cadastrada para este mês
              </p>
              <p className="text-xs text-muted max-w-sm mt-1">
                Contas com regras de recorrência (aluguel, condomínio, assinaturas) serão
                geradas automaticamente aqui em cada competência.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Descrição</TableHead>
                    <TableHead className="text-xs">Dia de Vencimento</TableHead>
                    <TableHead className="text-xs">Prazo</TableHead>
                    <TableHead className="text-xs text-right">Valor</TableHead>
                    <TableHead className="text-xs text-right">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {occurrences.map((item) => {
                    const dueInfo = describeDue(item.dueDate, today);
                    const isPaid = item.status === 'paid';

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs font-semibold text-foreground">
                          {item.description}
                        </TableCell>
                        <TableCell className="text-xs text-muted">
                          Dia {item.dueDay}
                        </TableCell>
                        <TableCell className="text-xs">
                          {dueInfo ? (
                            <span
                              className={cn(
                                'inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md',
                                dueInfo.state === 'overdue'
                                  ? 'bg-danger-soft text-danger'
                                  : dueInfo.state === 'today'
                                  ? 'bg-warning-soft text-warning'
                                  : 'bg-surface-muted text-muted',
                              )}
                            >
                              {dueInfo.label}
                            </span>
                          ) : (
                            item.dueDate
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-bold text-foreground text-right">
                          {formatBRL(item.amount)}
                        </TableCell>
                        <TableCell className="text-xs text-right">
                          <span
                            className={cn(
                              'inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase',
                              isPaid
                                ? 'bg-success-soft text-success'
                                : 'bg-warning-soft text-warning',
                            )}
                          >
                            {isPaid ? 'Pago' : 'Pendente'}
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

      {/* Category Budgets */}
      {categoryBudgets.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-foreground">
              Tetos por Categoria
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {categoryBudgets.map((cat) => (
                <div key={cat.id} className="p-3 rounded-xl border border-border bg-surface-muted/50">
                  <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                    <span>{cat.categoryName}</span>
                    <span>{formatBRL(cat.limit)}</span>
                  </div>
                  <div className="w-full bg-surface h-2 rounded-full overflow-hidden border border-border">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${Math.min(100, cat.limit > 0 ? (cat.spent / cat.limit) * 100 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
