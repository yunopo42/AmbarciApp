import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, JSX } from 'react';

import { cn } from '@/lib/utils';

// docs/tasarim.md: durum rozeti hap biçiminde, dikey 4 px / yatay 10 px, label-sm; durumun zemin, kenarlık ve metin
// tonu birlikte. Renk tek başına anlam taşımaz: rozetin içinde her zaman metin vardır ("Pasif", "Onay bekliyor").
const badgeVariants = cva('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-label-sm', {
  variants: {
    variant: {
      info: 'border-primary-soft bg-primary-soft text-primary',
      muted: 'border-border bg-divider text-text-muted',
      pending: 'border-pending-border bg-pending-soft text-pending',
      applied: 'border-applied-border bg-applied-soft text-applied',
      critical: 'border-critical-border bg-critical-soft text-critical',
    },
  },
  defaultVariants: { variant: 'info' },
});

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>): JSX.Element {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Ürün, depo ve cari listelerindeki durum: aktif kayıt bilgi, pasif kayıt sönük rozetle. */
export function RecordStatusBadge({ isActive }: { isActive: boolean }): JSX.Element {
  return isActive ? <Badge variant="info">Aktif</Badge> : <Badge variant="muted">Pasif</Badge>;
}
