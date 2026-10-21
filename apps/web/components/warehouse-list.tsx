'use client';

import { warehouseListSchema } from '@ambarci/shared';
import type { Warehouse } from '@ambarci/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { useOrganizations } from '@/components/organization-provider';
import { apiRequest, errorMessage } from '@/lib/api';
import { WAREHOUSE_TYPE_LABELS } from '@/lib/labels';

type ListState = { kind: 'loading' } | { kind: 'ready'; warehouses: Warehouse[] } | { kind: 'error'; message: string };

/** Aktif şirketin depoları. Depo ekleme ve stok 3. haftada gelecek. */
export function WarehouseList(): JSX.Element {
  const { active } = useOrganizations();
  if (!active) {
    return <p>Önce ana sayfadan bir şirket kur ya da bir şirkete katıl.</p>;
  }
  // Şirket değişince tablo sıfırdan kurulur; önceki şirketin depoları bir an bile görünmez.
  return <WarehouseTable key={active.id} organizationId={active.id} />;
}

function WarehouseTable({ organizationId }: { organizationId: string }): JSX.Element {
  const [state, setState] = useState<ListState>({ kind: 'loading' });

  useEffect(() => {
    let current = true;
    apiRequest('/v1/warehouses', { organizationId, schema: warehouseListSchema })
      .then((warehouses) => current && setState({ kind: 'ready', warehouses }))
      .catch((reason: unknown) => current && setState({ kind: 'error', message: errorMessage(reason) }));
    return () => {
      current = false;
    };
  }, [organizationId]);

  if (state.kind === 'loading') {
    return <p aria-live="polite">Depolar yükleniyor…</p>;
  }
  if (state.kind === 'error') {
    return <p role="alert">{state.message}</p>;
  }
  if (state.warehouses.length === 0) {
    return <p>Bu şirkette henüz depo yok. Depo ekleme ekranı 3. haftada gelecek.</p>;
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
        {state.warehouses.map((warehouse) => (
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
