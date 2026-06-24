'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  ArrowUpDown,
  X,
  FileText,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn, formatBRL, formatDate } from '@/lib/utils';

export interface DBTransaction {
  id: string;
  date: string; // ISO string
  description: string;
  category: string;
  amount: string; // numeric in DB
  source: string;
  latitude: number | null;
  longitude: number | null;
}

const categories = [
  { value: '', label: 'Todas as categorias' },
  { value: 'comida', label: 'Alimentação' },
  { value: 'transporte', label: 'Transporte' },
  { value: 'assinaturas', label: 'Assinaturas' },
  { value: 'lazer', label: 'Lazer' },
  { value: 'saude', label: 'Saúde' },
  { value: 'educacao', label: 'Educação' },
  { value: 'moradia', label: 'Moradia' },
  { value: 'salario', label: 'Salário' },
  { value: 'investimento', label: 'Investimento' },
  { value: 'transferencia', label: 'Transferência' },
];

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

const PAGE_SIZE = 8;

export default function TransactionsClient({ initialData }: { initialData: DBTransaction[] }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState<'date' | 'amount' | 'description'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const hasFilters = search || categoryFilter || dateFrom || dateTo;

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
      // Add 'T23:59:59' to dateTo to include the whole day
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
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold text-slate-50 sm:text-3xl">Transações</h1>
        <p className="mt-1 text-sm text-slate-400">
          {filtered.length} transação{filtered.length !== 1 ? 'ões' : ''} encontrada{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <Card className="animate-fade-in-up" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Buscar transação..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="pl-9"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="h-10 rounded-xl border border-slate-700/30 bg-slate-900/60 px-3 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all duration-200 backdrop-blur-sm cursor-pointer appearance-none w-full sm:w-48"
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value} className="bg-slate-900 text-slate-300">
                  {c.label}
                </option>
              ))}
            </select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full sm:w-40 text-slate-300"
              placeholder="Data início"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full sm:w-40 text-slate-300"
              placeholder="Data fim"
            />
            {hasFilters && (
              <Button variant="ghost" size="icon" onClick={clearFilters} className="flex-shrink-0" title="Limpar filtros">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="animate-fade-in-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
        <CardContent className="p-0">
          {paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/60 flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-lg font-medium text-slate-300">Nenhuma transação encontrada</p>
              <p className="mt-1 text-sm text-slate-500">Tente ajustar os filtros</p>
              {hasFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4">
                  Limpar filtros
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button onClick={() => toggleSort('date')} className="inline-flex items-center gap-1 hover:text-slate-200 transition-colors">
                      Data <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('description')} className="inline-flex items-center gap-1 hover:text-slate-200 transition-colors">
                      Descrição <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('amount')} className="inline-flex items-center gap-1 hover:text-slate-200 transition-colors">
                      Valor <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Fonte</TableHead>
                  <TableHead className="hidden lg:table-cell">Localização</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm text-slate-400 whitespace-nowrap">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-slate-200 max-w-[240px] truncate">
                      {tx.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tx.category as any}>
                        {categoryLabels[tx.category] ?? tx.category}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-sm font-semibold whitespace-nowrap',
                        Number(tx.amount) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                      )}
                    >
                      {Number(tx.amount) >= 0 ? '+' : ''}
                      {formatBRL(Number(tx.amount))}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium uppercase',
                          sourceColors[tx.source] ?? 'bg-slate-800 text-slate-300 border-slate-700/50',
                        )}
                      >
                        {tx.source}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {tx.latitude && tx.longitude ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <MapPin className="w-3.5 h-3.5" />
                          GPS
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-700/30">
            <p className="text-xs text-slate-400">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de{' '}
              {filtered.length} transações
            </p>
            <div className="flex items-center gap-2">
               <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Anterior
              </Button>
              <span className="text-xs text-slate-400 px-2">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Próximo
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
