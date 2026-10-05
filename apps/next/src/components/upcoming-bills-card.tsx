'use client';

import React from 'react';
import { Clock, CheckCircle2, AlertTriangle, Calendar, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { describeDue, civilToday, formatBRL } from '@ecofinance/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface UpcomingBill {
  id: string;
  description: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  category: string;
  accountName?: string;
  isPaid?: boolean;
}

interface UpcomingBillsCardProps {
  bills?: UpcomingBill[];
  className?: string;
}

export function UpcomingBillsCard({ bills = [], className }: UpcomingBillsCardProps) {
  const today = civilToday(new Date());

  const pendingBills = bills.filter((b) => !b.isPaid);

  return (
    <Card className={cn('animate-fade-in-up', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-warning/15 text-warning flex items-center justify-center">
            <Clock className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base">Próximas Contas</CardTitle>
            <p className="text-xs text-muted">Contas fixas e vencimentos deste mês</p>
          </div>
        </div>
        <Link
          href="/planning"
          className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1 transition-colors"
        >
          Planejamento
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </CardHeader>

      <CardContent>
        {pendingBills.length === 0 ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-success-soft text-success flex items-center justify-center mb-2">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">Tudo em dia!</p>
            <p className="text-xs text-muted max-w-xs mt-1">
              Nenhuma conta pendente para este mês.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border -mx-2">
            {pendingBills.slice(0, 5).map((bill) => {
              const dueInfo = describeDue(bill.dueDate, today);
              const isOverdue = dueInfo?.state === 'overdue';
              const isToday = dueInfo?.state === 'today';
              const isSoon = dueInfo?.state === 'soon';

              return (
                <div
                  key={bill.id}
                  className="p-3 flex items-center justify-between gap-3 hover:bg-surface-muted/50 rounded-xl transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                        isOverdue
                          ? 'bg-danger-soft text-danger'
                          : isToday
                          ? 'bg-warning-soft text-warning'
                          : isSoon
                          ? 'bg-info-soft text-info'
                          : 'bg-surface-muted text-muted',
                      )}
                    >
                      {isOverdue ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <Calendar className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {bill.description}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {bill.category}
                        </Badge>
                        {bill.accountName && (
                          <span className="text-[11px] text-muted truncate">
                            {bill.accountName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground">
                      {formatBRL(bill.amount)}
                    </p>
                    {dueInfo && (
                      <span
                        className={cn(
                          'inline-flex items-center text-[10px] font-semibold mt-0.5 px-1.5 py-0.5 rounded-md',
                          isOverdue
                            ? 'bg-danger-soft text-danger border border-danger/30'
                            : isToday
                            ? 'bg-warning-soft text-warning border border-warning/30'
                            : isSoon
                            ? 'bg-info-soft text-info border border-info/30'
                            : 'bg-surface-muted text-muted border border-border',
                        )}
                      >
                        {dueInfo.label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
