import type { Metadata } from 'next';
import type { JSX } from 'react';

import { NewProduct } from '@/components/product-form';

export const metadata: Metadata = {
  title: 'Yeni ürün · Ambarcı',
};

// Yetki API'de denetlenir (yalnızca yönetici); bu sayfa çalışana yalnızca bilgi mesajı gösterir.
export default function NewProductPage(): JSX.Element {
  return <NewProduct />;
}
