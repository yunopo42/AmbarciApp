import type { Metadata } from 'next';
import type { JSX } from 'react';

import { StockList } from '@/components/stock-list';

export const metadata: Metadata = {
  title: 'Stok · Ambarcı',
};

export default function StockPage(): JSX.Element {
  return <StockList />;
}
