import { Warehouse } from 'lucide-react';
import type { JSX } from 'react';

/** Uygulamanın adı ve işareti; sol menüde ve giriş/kayıt sayfalarında. */
export function Brand({ subtitle }: { subtitle?: string | null }): JSX.Element {
  return (
    <span className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary">
        <Warehouse aria-hidden className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-headline-sm text-primary">Ambarcı</span>
        {subtitle ? <span className="truncate text-label-md font-normal text-text-muted">{subtitle}</span> : null}
      </span>
    </span>
  );
}
