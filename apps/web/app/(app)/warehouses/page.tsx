import type { Metadata } from 'next';
import type { JSX } from 'react';

import { WarehouseList } from '@/components/warehouse-list';

export const metadata: Metadata = {
  title: 'Depolar · Ambarcı',
};

export default function WarehousesPage(): JSX.Element {
  return (
    <>
      <h1 className="text-xl font-semibold">Depolar</h1>
      <WarehouseList />
    </>
  );
}
