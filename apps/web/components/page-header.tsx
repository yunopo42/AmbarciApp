import type { JSX, ReactNode } from 'react';

/** Sayfa başlığı (headline-lg, primary), kısa açıklama ve sağda sayfanın ana işlemleri. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-headline-lg text-primary">{title}</h1>
        {description ? <p className="text-body-lg text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
