import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge, çakışan sınıflardan sonuncusunu bırakır: cn('px-2', 'px-4') → 'px-4'. Böylece bir bileşenin
// varsayılan sınıfları çağıran yerden güvenle ezilebilir. Varsayılan ayarı Tailwind'in hazır ölçeklerini bilir;
// app/globals.css'teki yazı ve gölge adlarını ona burada tanıtırız. Tanıtılmasaydı `text-body-md` bir renk sanılır ve
// `text-text-muted` ile birlikte yazıldığında silinirdi.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'headline-lg',
        'headline-md',
        'headline-sm',
        'title-md',
        'body-lg',
        'body-lg-bold',
        'body-md',
        'body-md-medium',
        'label-lg',
        'label-md',
        'label-sm',
      ],
      shadow: ['1', '2', '3'],
    },
  },
});

/** Koşullu sınıfları birleştirir ve çakışanlardan sonuncusunu bırakır (shadcn/ui'daki `cn`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
