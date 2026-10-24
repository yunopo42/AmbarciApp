import { Search } from 'lucide-react';
import type { ComponentProps, JSX } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Solunda arama ikonu olan giriş alanı (liste ekranlarının arama kutusu). */
export function SearchInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>): JSX.Element {
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-subtle" />
      <Input type="search" className="pl-9" {...props} />
    </div>
  );
}
