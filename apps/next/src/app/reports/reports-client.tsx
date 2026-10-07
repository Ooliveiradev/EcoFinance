'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, RefreshCw, Inbox } from 'lucide-react';
import { formatCents, moneyToCents, monthLabel, type MetricsQuery, type MetricsReport, type MonthProjection } from '@ecofinance/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ChartPoint, ChartSeries } from './reports-chart';

const ReportsChart = dynamic(() => import('./reports-chart'), {
  ssr: false,
  loading: () => <div role="status" className="h-full flex items-center justify-center text-xs text-muted">Carregando gráfico…</div>,
});
const CategoryChart = dynamic(() => import('../category-chart'), {
  ssr: false,
  loading: () => <div role="status" className="h-full flex items-center justify-center text-xs text-muted">Carregando gráfico…</div>,
});

const money = (value: string) => formatCents(moneyToCents(value));
// Chart geometry only; every label and tooltip uses the exact decimal string.
const size = (value: string) => Number(moneyToCents(value)) / 100;
const shortMonth = (month: string) => monthLabel(month).replace(/ de /, '/');
const BASIS = { competence: 'Competência', cash: 'Fluxo de caixa' } as const;
const INCOME = { competence: 'Receitas', cash: 'Entradas' } as const;
const EXPENSES = { competence: 'Despesas', cash: 'Saídas' } as const;

export interface ReportsClientProps {
  query: MetricsQuery;
  data: { report: MetricsReport; projection: MonthProjection } | null;
  notice?: string;
  error?: string;
}

export default function ReportsClient({ query, data, notice, error }: ReportsClientProps) {
  const router = useRouter();
  const exportHref = `/api/reports/export?${new URLSearchParams({ from: query.from, to: query.to, basis: query.basis })}`;
  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">Relatórios</h1>
          <p className="mt-1 text-sm text-muted">
            {BASIS[query.basis]} de {monthLabel(query.from)} a {monthLabel(query.to)}. Gráficos, tabelas, cartões e exportação usam o mesmo cálculo.
          </p>
        </div>
        <form method="get" action="/reports" className="flex flex-wrap items-end gap-3" aria-label="Filtros do relatório">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            De
            <input type="month" name="de" defaultValue={query.from} required className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Até
            <input type="month" name="ate" defaultValue={query.to} required className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Visão
            <select name="base" defaultValue={query.basis} className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground">
              <option value="competence">Competência</option>
              <option value="cash">Fluxo de caixa</option>
            </select>
          </label>
          <Button type="submit" className="touch-target">Aplicar</Button>
          {data && (
            <a href={exportHref} download className={cn(buttonVariants({ variant: 'outline' }), 'touch-target')}>
              <Download className="w-4 h-4 mr-1.5" />
              Exportar CSV
            </a>
          )}
        </form>
      </header>

      {notice && (
        <div role="status" className="p-3 rounded-xl bg-warning-soft text-warning border border-warning/20 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-danger-soft text-danger border border-danger/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Falha ao obter relatórios</p>
              <p className="text-xs opacity-90 mt-0.5">{error}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.refresh()} className="self-start sm:self-auto border-danger/30 text-danger touch-target">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Tentar novamente
          </Button>
        </div>
      )}
      {data && <ReportBody report={data.report} />}
    </div>
  );
}

function ReportBody({ report }: { report: MetricsReport }) {
  const { basis, totals } = report;
  const evolution: ChartPoint[] = report.months.map(row => ({
    label: shortMonth(row.month),
    values: { income: size(row.income), expenses: size(row.expenses) },
    labels: { income: money(row.income), expenses: money(row.expenses) },
  }));
  const split: ChartPoint[] = report.months.map(row => ({
    label: shortMonth(row.month),
    values: { fixed: size(row.fixed), variable: size(row.variable) },
    labels: { fixed: money(row.fixed), variable: money(row.variable) },
  }));
  const plan: ChartPoint[] = report.plan.map(row => ({
    label: shortMonth(row.month),
    values: { limit: row.limit ? size(row.limit) : 0, realized: size(row.realized), pending: size(row.pending) },
    labels: { limit: row.limit ? money(row.limit) : 'Sem orçamento', realized: money(row.realized), pending: money(row.pending) },
  }));
  const flowSeries: ChartSeries[] = [
    { key: 'income', name: INCOME[basis], color: 'var(--success)' },
    { key: 'expenses', name: EXPENSES[basis], color: 'var(--danger)' },
  ];
  const cards: Array<[string, string]> = [
    [INCOME[basis], money(totals.income)],
    [EXPENSES[basis], money(totals.expenses)],
    ['Resultado', money(totals.net)],
    ['Lançamentos considerados', String(totals.count)],
  ];
  return (
    <>
      <section aria-labelledby="report-totals-title">
        <h2 id="report-totals-title" className="sr-only">Totais do período</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(([label, value]) => (
            <Card key={label}>
              <CardContent className="p-5">
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
                <dd className="text-2xl font-bold text-foreground tracking-tight mt-2">{value}</dd>
              </CardContent>
            </Card>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">
          {basis === 'competence'
            ? 'Competência: receitas e despesas registradas no mês de referência; compras no cartão entram aqui e o pagamento da fatura não é contado de novo. Transferências e saldos iniciais ficam fora.'
            : 'Fluxo de caixa: movimentos liquidados pela data de pagamento, incluindo pagamento de fatura; compras no cartão ainda não pagas e transferências entre contas próprias ficam fora.'}
        </p>
      </section>

      <Card>
        <CardHeader><CardTitle className="text-base font-bold">Evolução mensal</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="h-[260px]"><ReportsChart data={evolution} series={flowSeries} label={`Gráfico de ${INCOME[basis].toLowerCase()} e ${EXPENSES[basis].toLowerCase()} por mês`} /></div>
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">Totais mensais ({BASIS[basis]})</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Mês</TableHead>
                  <TableHead className="text-xs text-right">{INCOME[basis]}</TableHead>
                  <TableHead className="text-xs text-right">{EXPENSES[basis]}</TableHead>
                  <TableHead className="text-xs text-right">Resultado</TableHead>
                  <TableHead className="text-xs text-right">Fixos</TableHead>
                  <TableHead className="text-xs text-right">Variáveis</TableHead>
                  <TableHead className="text-xs text-right">Lançamentos</TableHead>
                  <TableHead className="text-xs">Despesas vs mês anterior</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.months.map(row => (
                  <TableRow key={row.month}>
                    <TableCell className="text-xs font-medium capitalize">{monthLabel(row.month)}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.income)}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.expenses)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{money(row.net)}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.fixed)}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.variable)}</TableCell>
                    <TableCell className="text-xs text-right">{row.count}</TableCell>
                    <TableCell className="text-xs text-muted" title={row.trend.expenses.label}>
                      {row.trend.expenses.direction === 'unknown' ? 'Sem referência' : row.trend.expenses.short}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-xs font-bold">Total</TableCell>
                  <TableCell className="text-xs text-right font-bold">{money(totals.income)}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{money(totals.expenses)}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{money(totals.net)}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{money(totals.fixed)}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{money(totals.variable)}</TableCell>
                  <TableCell className="text-xs text-right font-bold">{totals.count}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base font-bold">Despesas por categoria</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {report.categories.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-center">
                <Inbox className="w-6 h-6 text-muted mb-2" />
                <p className="text-sm font-semibold">Nenhuma despesa no período</p>
              </div>
            ) : (
              <>
                <div className="h-[240px]">
                  <CategoryChart data={report.categories.filter(c => moneyToCents(c.amount) > 0n).map(c => ({ id: c.id, name: c.name, color: c.color, value: size(c.amount), formatted: money(c.amount) }))} colors={{}} />
                </div>
                <Table>
                  <caption className="sr-only">Despesas por categoria no período</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Categoria</TableHead>
                      <TableHead className="text-xs text-right">Valor</TableHead>
                      <TableHead className="text-xs text-right">Participação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.categories.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ backgroundColor: c.color }} aria-hidden="true" />
                          {c.name}
                        </TableCell>
                        <TableCell className="text-xs text-right font-semibold">{money(c.amount)}</TableCell>
                        <TableCell className="text-xs text-right text-muted">{c.share.replace('.', ',')}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base font-bold">Fixos versus variáveis</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="h-[240px]">
              <ReportsChart stacked data={split} label="Gráfico de despesas fixas e variáveis por mês" series={[
                { key: 'fixed', name: 'Fixos', color: 'var(--primary)' },
                { key: 'variable', name: 'Variáveis', color: 'var(--warning)' },
              ]} />
            </div>
            <p className="text-xs text-muted">
              Fixos: recorrências e parcelas (estornos seguem a compra original). Total: fixos {money(totals.fixed)} · variáveis {money(totals.variable)}.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Previsto versus realizado</CardTitle>
          <p className="text-xs text-muted">Sempre por competência, a mesma base do orçamento mensal. Pendente = recorrências ainda não pagas; uma recorrência paga conta só como realizada.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-[240px]">
            <ReportsChart data={plan} label="Gráfico de orçamento, realizado e pendente por mês" series={[
              { key: 'limit', name: 'Limite', color: 'var(--border-strong)' },
              { key: 'realized', name: 'Realizado', color: 'var(--danger)' },
              { key: 'pending', name: 'Pendente', color: 'var(--warning)' },
            ]} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">Previsto versus realizado por mês</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Mês</TableHead>
                  <TableHead className="text-xs text-right">Limite</TableHead>
                  <TableHead className="text-xs text-right">Renda prevista</TableHead>
                  <TableHead className="text-xs text-right">Realizado</TableHead>
                  <TableHead className="text-xs text-right">Pendente</TableHead>
                  <TableHead className="text-xs text-right">Comprometido</TableHead>
                  <TableHead className="text-xs text-right">Restante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.plan.map(row => (
                  <TableRow key={row.month}>
                    <TableCell className="text-xs font-medium capitalize">{monthLabel(row.month)}</TableCell>
                    <TableCell className="text-xs text-right">{row.limit ? money(row.limit) : 'Sem orçamento'}</TableCell>
                    <TableCell className="text-xs text-right">{row.expectedIncome ? money(row.expectedIncome) : '—'}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.realized)}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.pending)}</TableCell>
                    <TableCell className="text-xs text-right">{money(row.committed)}</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{row.remaining ? money(row.remaining) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
