'use client';

import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { useOrganizations } from '@/components/organization-provider';
import { errorMessage } from '@/lib/api-client';
import { WAREHOUSE_TYPE_LABELS } from '@/lib/labels';

/** Aktif şirketin depoları. Depo ekleme ekranı #36'da gelecek. */
export function WarehouseList(): JSX.Element {
  const { active } = useOrganizations();
  if (!active) {
    return <p>Önce ana sayfadan bir şirket kur ya da bir şirkete katıl.</p>;
  }
  // Şirket değişince şirket katmanı (istemci ve önbellek) baştan kurulur; önceki şirketin depoları görünmez.
  return <WarehouseTable />;
}

function WarehouseTable(): JSX.Element {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/warehouses');

  if (query.isPending) {
    return <p aria-live="polite">Depolar yükleniyor…</p>;
  }
  if (query.isError) {
    return <p role="alert">{errorMessage(query.error)}</p>;
  }
  const warehouses = query.data;
  if (warehouses.length === 0) {
    return <p>Bu şirkette henüz depo yok. Depo ekleme ekranı sonraki işte (#36) gelecek.</p>;
  }
  return (
    <table className="w-full max-w-3xl border-collapse text-left">
      <thead>
        <tr className="border-b">
          <th className="p-2">Ad</th>
          <th className="p-2">Tür</th>
          <th className="p-2">Durum</th>
        </tr>
      </thead>
      <tbody>
        {warehouses.map((warehouse) => (
          <tr key={warehouse.id} className="border-b">
            <td className="p-2">{warehouse.name}</td>
            <td className="p-2">{WAREHOUSE_TYPE_LABELS[warehouse.type]}</td>
            <td className="p-2">{warehouse.isActive ? 'Aktif' : 'Pasif'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
