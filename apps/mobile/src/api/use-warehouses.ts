import type { Warehouse } from '@ambarci/shared';
import { useMemo } from 'react';

import { useApi } from '@/api/api-provider';
import { useOrganizations } from '@/api/organization-provider';
import { errorMessage } from '@/lib/api';

const NO_WAREHOUSES: Warehouse[] = [];

export interface WarehouseOptions {
  isPending: boolean;
  error: string | null;
  /**
   * Kullanıcının stoğunu görebildiği aktif depolar: yönetici için hepsi, çalışan için yetkili olduğu depolar
   * (üyelikteki warehouseIds). Yalnızca seçenekleri süzer; asıl yetki API'de denetlenir.
   */
  permitted: Warehouse[];
  refetch: () => Promise<unknown>;
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
    const usable = all.filter((warehouse) => warehouse.isActive);
    return active.role === 'ADMIN' ? usable : usable.filter((warehouse) => active.warehouseIds.includes(warehouse.id));
  }, [active, all]);

  return {
    isPending: query.isPending,
    error: query.isError ? errorMessage(query.error) : null,
    permitted,
    refetch: query.refetch,
  };
}
