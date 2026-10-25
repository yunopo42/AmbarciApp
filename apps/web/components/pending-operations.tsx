'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api-client';
import { ACTION_SOURCE_LABELS, formatDateTime, OPERATION_TYPE_LABELS } from '@/lib/labels';

const SHOWN = 20;

/**
 * Onay bekleyen işlemler: ekrandan açılıp bırakılan fiş ya da içe aktarmanın açılış işlemi buradan özetine döner.
 * Çalışan yalnızca bütün depolarında yetkili olduğu işlemleri görür (API). Bekleyen işlem yoksa hiç görünmez.
 * 5–6. haftadaki onay kuyruğu bunun üzerine kurulacak.
 */
export function PendingOperations(): JSX.Element | null {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/operations', {
    params: { query: { status: 'PENDING_CONFIRMATION', pageSize: SHOWN } },
  });

  if (query.isError) {
    return <Alert>{errorMessage(query.error)}</Alert>;
  }
  if (query.isPending || query.data.total === 0) {
    return null;
  }
  const { items, total } = query.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Onay bekleyen işlemler
          <Badge variant="pending">{total}</Badge>
        </CardTitle>
        <CardDescription>Bu işlemler onaylanana kadar stok değişmez. Özetini açıp onaylayın ya da iptal edin.</CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y divide-divider">
        {items.map((operation) => (
          <li key={operation.id}>
            <Link
              href={`/operations/${operation.id}`}
              className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary-action"
            >
              <span className="text-body-md-medium text-text">{OPERATION_TYPE_LABELS[operation.type]}</span>
              <span className="text-text-muted tabular-nums">
                {operation.lineCount} kalem · {operation.warehouses.map((warehouse) => warehouse.name).join(', ')} ·{' '}
                {ACTION_SOURCE_LABELS[operation.source]} · {formatDateTime(operation.createdAt)}
              </span>
              <span className="ml-auto flex items-center gap-1 text-label-md text-primary-action">
                Özeti aç
                <ChevronRight aria-hidden className="size-4" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total > items.length ? (
        <p className="text-text-muted">En yeni {items.length} işlem gösteriliyor; toplam {total}.</p>
      ) : null}
    </Card>
  );
}
