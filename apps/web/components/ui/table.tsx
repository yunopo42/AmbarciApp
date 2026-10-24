import type { ComponentProps, JSX } from 'react';

import { cn } from '@/lib/utils';

// shadcn/ui tablo parçaları, tasarım değerleriyle: tablo kutusu kart gibi (border, köşe 12 px, gölge 1); başlık
// label-sm ve büyük harf; satır en az 56 px, dikey 14 px iç boşluk, divider ayırıcı (docs/tasarim.md).

export function Table({ className, ...props }: ComponentProps<'table'>): JSX.Element {
  return (
    <div data-slot="table-container" className="w-full overflow-x-auto rounded-lg border border-border bg-card shadow-1">
      <table data-slot="table" className={cn('w-full border-collapse text-left text-body-md', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>): JSX.Element {
  return <thead data-slot="table-header" className={cn('border-b border-border', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>): JSX.Element {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>): JSX.Element {
  return <tr data-slot="table-row" className={cn('h-14 border-b border-divider', className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<'th'>): JSX.Element {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn('whitespace-nowrap px-4 py-3 text-label-sm uppercase text-text-muted', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>): JSX.Element {
  return <td data-slot="table-cell" className={cn('px-4 py-3.5 align-middle', className)} {...props} />;
}
