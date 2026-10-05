import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold transition-colors duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm shadow-primary/20',
        secondary:
          'bg-surface-muted text-foreground hover:bg-surface-raised border border-border',
        outline:
          'border border-border bg-surface text-foreground hover:bg-surface-muted',
        ghost:
          'text-muted hover:bg-surface-muted hover:text-foreground',
        destructive:
          'bg-danger text-white hover:opacity-90 shadow-sm shadow-danger/20',
        link:
          'text-link underline-offset-4 hover:underline p-0 h-auto font-medium',
      },
      size: {
        default: 'h-10 px-4 py-2 min-h-[2.5rem]',
        sm: 'h-9 rounded-lg px-3 text-xs min-h-[2.25rem]',
        lg: 'h-12 rounded-xl px-6 text-base min-h-[3rem]',
        icon: 'h-10 w-10 min-h-[2.5rem] min-w-[2.5rem] p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
