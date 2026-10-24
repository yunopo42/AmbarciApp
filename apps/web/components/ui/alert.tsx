import { CircleAlert, CircleCheck } from 'lucide-react';
import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Form ve sayfa düzeyindeki mesaj. Hata kritik, başarı "uygulandı" renk üçlüsüyle ve ikonla gösterilir; hata
 * role="alert" ile ekran okuyucuya hemen okunur.
 */
export function Alert({
  variant = 'critical',
  className,
  children,
}: {
  variant?: 'critical' | 'applied';
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const critical = variant === 'critical';
  const Icon = critical ? CircleAlert : CircleCheck;
  return (
    <div
      role={critical ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-body-md',
        critical ? 'border-critical-border bg-critical-soft text-critical' : 'border-applied-border bg-applied-soft text-applied',
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
