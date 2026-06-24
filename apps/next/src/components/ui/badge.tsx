import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-slate-800 text-slate-300 border-slate-700/50',
        comida: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
        transporte: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        assinaturas: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        lazer: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
        saude: 'bg-red-500/15 text-red-400 border-red-500/30',
        educacao: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
        moradia: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        salario: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        investimento: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
        transferencia: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
        desconhecido: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
        success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        error: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
