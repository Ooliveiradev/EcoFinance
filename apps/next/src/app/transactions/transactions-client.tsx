'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  ArrowUpDown,
  X,
  FileText,
  Upload,
  Plus,
} from 'lucide-react';
import {
  TRANSACTION_CATEGORY_OPTIONS,
  TRANSACTION_CATEGORY_LABELS,
  type TransactionCategory,
} from '@ecofinance/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn, formatBRL, formatDate } from '@/lib/utils';
import { AddExpenseModal } from '@/components/add-expense-modal';

export interface DBTransaction {
  id: string;
  date: string; // ISO string
  description: string;
  category: TransactionCategory;
  amount: string; // numeric in DB
  source: string;
  latitude: number | null;
  longitude: number | null;
}

const sourceColors: Record<string, string> = {
  pluggy: 'bg-info-soft text-info border-info/30',
  notification: 'bg-success-soft text-success border-success/30',
  ofx: 'bg-warning-soft text-warning border-warning/30',
  uber: 'bg-surface-muted text-muted border-border',
  manual: 'bg-surface-raised text-foreground border-border',
  csv: 'bg-warning-soft text-warning border-warning/30',
};

const PAGE_SIZE = 10;

export default function TransactionsClient({ initialData }: { initialData: DBTransaction[] }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<'date' | 'amount' | 'description'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);

  const hasFilters = Boolean(search || categoryFilter || dateFrom || dateTo);

  const filtered = useMemo(() => {
    let data = [...initialData];

    if (search) {
      const q = search.toLowerCase();
      data = data.filter((t) => t.description.toLowerCase().includes(q));
    }
    if (categoryFilter) {
      data = data.filter((t) => t.category === categoryFilter);
    }
    if (dateFrom) {
      data = data.filter((t) => t.date >= dateFrom);
    }
    if (dateTo) {
      const toDate = `${dateTo}T23:59:59`;
      data = data.filter((t) => t.date <= toDate);
    }

    data.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortField === 'amount') cmp = Number(a.amount) - Number(b.amount);
      else cmp = a.description.localeCompare(b.description);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return data;
  }, [initialData, search, categoryFilter, dateFrom, dateTo, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setCategoryFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl tracking-tight">
            Lançamentos
          </h1>
          <p className="mt-1 text-sm text-muted">
            {filtered.length} lançamento{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            onClick={() => setIsAddExpenseOpen(true)}
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

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div className="space-y-1">
              <label htmlFor="transaction-search" className="text-xs font-semibold text-muted">
                Buscar por descrição
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                <Input
                  id="transaction-search"
                  placeholder="Ex: Mercado, Uber..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="transaction-category" className="text-xs font-semibold text-muted">
                Categoria
              </label>
              <select
                id="transaction-category"
                aria-label="Filtrar por categoria"
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-sm text-foreground focus-visible:outline-none cursor-pointer"
              >
                <option value="">Todas as categorias</option>
                {TRANSACTION_CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="date-from" className="text-xs font-semibold text-muted">
                Data início
              </label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="space-y-1 flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="date-to" className="text-xs font-semibold text-muted">
                  Data fim
                </label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={clearFilters}
                  className="h-10 w-10 text-muted hover:text-foreground shrink-0"
                  title="Limpar filtros"
                  aria-label="Limpar filtros"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-surface-muted text-muted flex items-center justify-center mb-3">
                <FileText className="w-7 h-7" />
              </div>
              <p className="text-base font-semibold text-foreground">
                Nenhum lançamento encontrado
              </p>
              <p className="mt-1 text-xs text-muted">
                {hasFilters ? 'Tente ajustar ou limpar os filtros de busca' : 'Registre seu primeiro gasto ou importe um extrato'}
              </p>
              {hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4 touch-target">
                  Limpar filtros
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setIsAddExpenseOpen(true)}
                  className="mt-4 touch-target"
                >
                  <Plus className="w-4 h-4 mr-1.5" />
                  Adicionar gasto
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        onClick={() => toggleSort('date')}
                        className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                      >
                        Data <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => toggleSort('description')}
                        className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                      >
                        Descrição <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">
                      <button
                        onClick={() => toggleSort('amount')}
                        className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary transition-colors cursor-pointer ml-auto"
                      >
                        Valor <ArrowUpDown className="w-3.5 h-3.5" />
                      </button>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">Origem</TableHead>
                    <TableHead className="hidden lg:table-cell text-center">Localização</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((tx) => {
                    const isPositive = Number(tx.amount) >= 0;
                    const catLabel = TRANSACTION_CATEGORY_LABELS[tx.category] ?? tx.category;
                    const sourceInfo = sourceColors[tx.source] ?? 'bg-surface-muted text-muted border-border';

                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs text-muted whitespace-nowrap">
                          {formatDate(tx.date)}
                        </TableCell>
                        <TableCell className="text-xs font-semibold text-foreground max-w-[240px] truncate">
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
                          {formatBRL(Number(tx.amount))}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase',
                              sourceInfo,
                            )}
                          >
                            {tx.source}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-center">
                          {tx.latitude && tx.longitude ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                              <MapPin className="w-3.5 h-3.5" />
                              GPS
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <p className="text-xs text-muted">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de{' '}
              {filtered.length} lançamentos
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="touch-target"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Anterior
              </Button>
              <span className="text-xs font-semibold text-foreground px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="touch-target"
              >
                Próximo
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <AddExpenseModal
        isOpen={isAddExpenseOpen}
        onClose={() => setIsAddExpenseOpen(false)}
      />
    </div>
  );
}
