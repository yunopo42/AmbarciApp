import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Alanın açıklama ve hata metinlerinin kimlikleri; giriş alanı bunları aria-describedby ile bağlar. */
export function fieldDescriptionIds(id: string, { hint, error }: { hint?: boolean; error?: string | null }): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * Form alanı: etiket, alan, açıklama ve hata. Hata metni alanın altında 13 px ve kritik renkte (docs/tasarim.md);
 * ekran okuyucu alanı odakladığında hatayı da okur (aria-describedby).
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div data-slot="field" className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-body-md-medium text-text">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-label-md font-normal text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-label-md text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
