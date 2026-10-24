import type { ComponentProps, JSX } from 'react';

import { cn } from '@/lib/utils';

// docs/tasarim.md: kart zemini card, kenarlık border, köşe 12 px, iç boşluk 16 px, gölge seviye 1.

export function Card({ className, ...props }: ComponentProps<'section'>): JSX.Element {
  return (
    <section
      data-slot="card"
      className={cn('flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-1', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>): JSX.Element {
  return <h2 data-slot="card-title" className={cn('text-headline-sm text-text', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>): JSX.Element {
  return <p data-slot="card-description" className={cn('text-body-md text-text-muted', className)} {...props} />;
}
