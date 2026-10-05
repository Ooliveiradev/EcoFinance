import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors duration-150',
  {
    variants: {
      variant: {
        default: 'bg-surface-muted text-foreground border-border',
        outline: 'bg-transparent text-foreground border-border',
        success: 'bg-success-soft text-success border-success/30',
        warning: 'bg-warning-soft text-warning border-warning/30',
        error: 'bg-danger-soft text-danger border-danger/30',
        info: 'bg-info-soft text-info border-info/30',
        // Legacy category variants with high-contrast text and border
        comida: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
        transporte: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
        assinaturas: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30',
        lazer: 'bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/30',
        saude: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
        educacao: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
        moradia: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
        salario: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
        investimento: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30',
        transferencia: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
        desconhecido: 'bg-surface-muted text-muted border-border',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);
