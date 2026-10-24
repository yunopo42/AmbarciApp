import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ProductList } from '@/components/product-list';

export const metadata: Metadata = {
  title: 'Ürünler · Ambarcı',
};

export default function ProductsPage(): JSX.Element {
  return <ProductList />;
}
