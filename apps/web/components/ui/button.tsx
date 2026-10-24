import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, JSX } from 'react';

import { cn } from '@/lib/utils';

// docs/tasarim.md "Bileşen kuralları": ana düğme primary zemin, üzerine gelince primary-action; ikincil düğme card zemin
// ve border-strong kenarlık; en az 48 px yükseklik, yatay 20 px, köşe 8 px. `sm` tablo satırı ve sayfalama gibi sık
// tekrar eden küçük düğmeler içindir (label-md, 40 px).
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-action disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-action active:bg-primary-action',
        secondary: 'border border-border-strong bg-card text-primary hover:bg-primary-soft',
        ghost: 'text-primary hover:bg-primary-soft',
      },
      size: {
        md: 'min-h-12 px-5 text-label-lg',
        sm: 'min-h-10 px-3 text-label-md',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

/**
 * shadcn/ui düğmesi, tasarım değerlerine uyarlanmış. Bağlantıyı düğme gibi göstermek için `buttonVariants` doğrudan
 * `<Link className={buttonVariants(...)}>` ile kullanılır.
 */
export function Button({ className, variant, size, type = 'button', ...props }: ComponentProps<'button'> & ButtonVariantProps): JSX.Element {
  return <button data-slot="button" type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
