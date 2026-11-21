'use client';

import { useApi } from '@/components/api-provider';

/**
 * Onay bekleyen işlem sayısı: menüdeki "Onay kuyruğu" rozeti ve gösterge panelinin kutusu. İkisi aynı sorguyu (aynı
 * parametrelerle) kullanır, tek istek gider. Sayı onay kuyruğundaki kuralla aynıdır: çalışan yalnızca bütün depolarında
 * yetkili olduğu işlemleri sayar. Bir işlem onaylanınca ya da iptal edilince işlem listesiyle birlikte yenilenir.
 */
export function usePendingCount(): { count: number | null; error: unknown } {
  const { $api } = useApi();
  const query = $api.useQuery(
    'get',
    '/v1/operations',
    { params: { query: { status: 'PENDING_CONFIRMATION', page: 1, pageSize: 1 } } },
    // Başka bir kullanıcının (ya da sohbetin) açtığı işlem de görünsün diye dakikada bir.
    { refetchInterval: 60_000 },
  );
  return { count: query.data?.total ?? null, error: query.error };
}
