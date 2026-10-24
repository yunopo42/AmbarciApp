import type { Metadata } from 'next';
import type { JSX } from 'react';

import { EditProduct } from '@/components/product-form';

export const metadata: Metadata = {
  title: 'Ürün · Ambarcı',
};

export default async function ProductPage(props: PageProps<'/products/[productId]'>): Promise<JSX.Element> {
  const { productId } = await props.params;
  return <EditProduct productId={productId} />;
}
