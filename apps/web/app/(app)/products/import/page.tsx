import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ProductImport } from '@/components/product-import';

export const metadata: Metadata = {
  title: 'Ürünleri içe aktar · Ambarcı',
};

// Yetki API'de denetlenir (yalnızca yönetici); bu sayfa çalışana yalnızca bilgi mesajı gösterir.
export default function ProductImportPage(): JSX.Element {
  return <ProductImport />;
}
