'use client';

import React from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { shiftMonth, monthLabel, currentMonthParam } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MonthSelectorProps {
  currentMonth: string;
  onMonthChange?: (month: string) => void;
  className?: string;
}

export function MonthSelector({
  currentMonth,
  onMonthChange,
  className,
}: MonthSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const now = new Date();
  const todayMonth = currentMonthParam(now);
  const isCurrentMonth = currentMonth === todayMonth;

  const navigateMonth = (targetMonth: string) => {
    if (onMonthChange) {
      onMonthChange(targetMonth);
      return;
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (targetMonth === todayMonth) {
      params.delete('mes');
    } else {
      params.set('mes', targetMonth);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const prevMonth = shiftMonth(currentMonth, -1);
  const nextMonth = shiftMonth(currentMonth, 1);

  return (
    <nav
      aria-label="Navegação por mês"
      className={cn(
        'inline-flex items-center gap-1.5 p-1 bg-surface-muted border border-border rounded-xl shadow-xs',
        className,
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="Ir para o mês anterior"
        disabled={!prevMonth}
        onClick={() => prevMonth && navigateMonth(prevMonth)}
        className="h-8 w-8 text-foreground hover:bg-surface-raised"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      <div className="flex items-center gap-2 px-3 py-1 text-sm font-bold text-foreground capitalize select-none">
        <Calendar className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
        <span>{monthLabel(currentMonth)}</span>
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label="Ir para o próximo mês"
        disabled={!nextMonth}
        onClick={() => nextMonth && navigateMonth(nextMonth)}
        className="h-8 w-8 text-foreground hover:bg-surface-raised"
      >
        <ChevronRight className="w-4 h-4" />
      </Button>

      {!isCurrentMonth && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigateMonth(todayMonth)}
          className="h-7 px-2.5 text-xs text-primary border-primary/40 hover:bg-primary/10 ml-1"
        >
          Mês atual
        </Button>
      )}
    </nav>
  );
}
