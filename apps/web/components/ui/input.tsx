import type { ComponentProps, JSX } from 'react';

import { cn } from '@/lib/utils';

// docs/tasarim.md: giriş alanı en az 48 px, kenarlık 1,5 px border-strong, köşe 8 px; odakta 2 px primary-action
// halka; hatada (aria-invalid) kritik kenarlık. Açılır liste aynı görünümü paylaşır.
export const controlClasses =
  'min-h-12 w-full rounded-md border-[1.5px] border-border-strong bg-card px-3 text-body-md text-text placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-primary-action disabled:cursor-not-allowed disabled:bg-divider disabled:text-text-muted aria-invalid:border-critical';

export function Input({ className, ...props }: ComponentProps<'input'>): JSX.Element {
  return <input data-slot="input" className={cn(controlClasses, className)} {...props} />;
}

/** Tarayıcının kendi açılır listesi: klavye, ekran okuyucu ve mobilde yerel seçici kendiliğinden çalışır. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>): JSX.Element {
  return <select data-slot="native-select" className={cn(controlClasses, 'pr-8', className)} {...props} />;
}

/** Onay kutusu: görünen kutu 22 px, seçiliyken primary dolgu (docs/tasarim.md). Dokunma alanını saran etiket verir. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>): JSX.Element {
  return (
    <input
      data-slot="checkbox"
      type="checkbox"
      className={cn('size-[22px] shrink-0 cursor-pointer rounded-sm accent-primary disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}
