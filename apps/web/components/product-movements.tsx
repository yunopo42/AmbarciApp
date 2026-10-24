'use client';

import type { ProductMovement } from '@ambarci/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import type { PaginationState } from '@tanstack/react-table';
import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Alert } from '@/components/ui/alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumns, dataTableFeatures } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { useWarehouses } from '@/components/use-warehouses';
import { errorMessage } from '@/lib/api-client';
import { formatDecimal } from '@/lib/format';
import { formatDateTime, MOVEMENT_TYPE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

const column = createColumnHelper<typeof dataTableFeatures, ProductMovement>();

const movementColumns: DataTableColumns<ProductMovement> = column.columns([
  column.accessor('createdAt', {
    header: 'Tarih',
    cell: (info) => <span className="whitespace-nowrap">{formatDateTime(info.getValue())}</span>,
  }),
  column.accessor((movement) => movement.warehouse.name, { id: 'warehouse', header: 'Depo' }),
  column.accessor('type', { header: 'Hareket', cell: (info) => MOVEMENT_TYPE_LABELS[info.getValue()] }),
  column.accessor('quantityChange', {
    header: 'Değişim',
    // İşaret metnin içinde (+ / −): renk tek başına yönü anlatmaz.
    cell: (info) => (
      <span className={cn('text-body-md-medium', info.getValue().startsWith('-') ? 'text-critical' : 'text-applied')}>
        {formatDecimal(info.getValue(), { signed: true })}
      </span>
    ),
    meta: { className: 'text-right tabular-nums' },
  }),
  column.accessor('quantityAfter', {
    header: 'Sonraki stok',
    cell: (info) => formatDecimal(info.getValue()),
    meta: { className: 'text-right tabular-nums' },
  }),
  column.accessor('unitCost', {
    header: 'Birim maliyet',
    cell: (info) => <span className="whitespace-nowrap">{formatDecimal(info.getValue())} TL</span>,
    meta: { className: 'text-right tabular-nums' },
  }),
  column.display({
    id: 'operation',
    header: () => <span className="sr-only">İşlem</span>,
    cell: ({ row }) => (
      <Link href={`/operations/${row.original.operationId}`} className="text-primary-action underline">
        İşlem
      </Link>
    ),
    meta: { className: 'w-0 text-right' },
  }),
]);

/**
 * Ürünün hareket geçmişi (en yeni önce), isteğe bağlı depo süzgeciyle. Çalışan yalnızca yetkili olduğu depoların
 * hareketlerini görür; süzgeç de yalnızca o depoları listeler.
 */
export function ProductMovements({ productId, baseUnit }: { productId: string; baseUnit: string }): JSX.Element {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');

  return (
    <Card id="hareketler">
      <CardHeader>
        <CardTitle>Hareket geçmişi</CardTitle>
        <CardDescription>En yeni hareket önce. Miktarlar ana birimde ({baseUnit}).</CardDescription>
      </CardHeader>
      <Field id="movement-warehouse" label="Depo" className="w-full sm:w-64">
        <NativeSelect id="movement-warehouse" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
          <option value="">Bütün depolar</option>
          {warehouses.permitted.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {/* Depo değişince sayfalama baştan başlar. */}
      <MovementTable key={warehouseId} productId={productId} warehouseId={warehouseId} />
    </Card>
  );
}

function MovementTable({ productId, warehouseId }: { productId: string; warehouseId: string }): JSX.Element {
  const { $api } = useApi();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const query = $api.useQuery(
    'get',
    '/v1/products/{productId}/movements',
    {
      params: {
        path: { productId },
        query: { warehouseId: warehouseId || undefined, page: pagination.pageIndex + 1, pageSize: pagination.pageSize },
      },
    },
    { placeholderData: keepPreviousData },
  );

  if (query.isError) {
    return <Alert>{errorMessage(query.error)}</Alert>;
  }
  if (query.isPending) {
    return (
      <p aria-live="polite" className="text-text-muted">
        Hareketler yükleniyor…
      </p>
    );
  }
  return (
    <DataTable
      label="Hareket geçmişi"
      columns={movementColumns}
      data={query.data.items}
      getRowId={(movement) => movement.id}
      emptyMessage="Bu ürünün henüz hareketi yok."
      pagination={{ state: pagination, onChange: setPagination, rowCount: query.data.total }}
      isFetching={query.isPlaceholderData}
    />
  );
}
