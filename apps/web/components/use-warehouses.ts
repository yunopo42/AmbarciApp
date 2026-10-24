'use client';

import type { Warehouse } from '@ambarci/shared';
import { useMemo } from 'react';

import { useApi } from '@/components/api-provider';
import { useOrganizations } from '@/components/organization-provider';
import { errorMessage } from '@/lib/api-client';

const NO_WAREHOUSES: Warehouse[] = [];

export interface WarehouseOptions {
  isPending: boolean;
  error: string | null;
  /** Şirketin bütün depoları (pasifler dahil). */
  all: Warehouse[];
  /**
   * Kullanıcının işlem yapıp stoğunu görebildiği depolar: yönetici için hepsi, çalışan için yetkili olduğu depolar
   * (üyelikteki warehouseIds). Bu yalnızca ekrandaki seçenekleri süzer; asıl yetki API'de denetlenir.
   */
  permitted: Warehouse[];
}

export function useWarehouses(): WarehouseOptions {
  const { $api } = useApi();
  const { active } = useOrganizations();
  const query = $api.useQuery('get', '/v1/warehouses');
  const all = query.data ?? NO_WAREHOUSES;

  const permitted = useMemo(() => {
    if (!active) {
      return NO_WAREHOUSES;
    }
    return active.role === 'ADMIN' ? all : all.filter((warehouse) => active.warehouseIds.includes(warehouse.id));
  }, [active, all]);

  return {
    isPending: query.isPending,
    error: query.isError ? errorMessage(query.error) : null,
    all,
    permitted,
  };
}
