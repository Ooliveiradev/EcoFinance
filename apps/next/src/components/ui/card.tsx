import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'bg-slate-900/60 backdrop-blur-xl border border-slate-700/30 rounded-2xl shadow-lg shadow-black/20 transition-all duration-300',
        className,
      )}
      {...props}
    />
  );
}
Card.displayName = 'Card';

function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 p-6', className)}
      {...props}
    />
  );
}
CardHeader.displayName = 'CardHeader';

function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-lg font-semibold leading-none tracking-tight text-slate-50',
        className,
      )}
      {...props}
    />
  );
}
CardTitle.displayName = 'CardTitle';

function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-slate-400', className)}
      {...props}
    />
  );
}
CardDescription.displayName = 'CardDescription';

function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-6 pt-0', className)} {...props} />
  );
}
CardContent.displayName = 'CardContent';

function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center p-6 pt-0', className)}
      {...props}
    />
  );
}
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
