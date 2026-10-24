'use client';

import type { StockLevel } from '@ambarci/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import type { PaginationState } from '@tanstack/react-table';
import { ClockArrowDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumns, dataTableFeatures } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { useWarehouses } from '@/components/use-warehouses';
import { errorMessage } from '@/lib/api-client';
import { formatDecimal } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';

const PAGE_SIZE = 25;

const column = createColumnHelper<typeof dataTableFeatures, StockLevel>();

const stockColumns: DataTableColumns<StockLevel> = column.columns([
  column.accessor('sku', {
    header: 'SKU',
    cell: (info) => <span className="text-body-md-medium tabular-nums">{info.getValue()}</span>,
  }),
  column.accessor('name', {
    header: 'Ürün',
    cell: (info) => <span className="text-body-md-medium">{info.getValue()}</span>,
  }),
  column.accessor('quantity', {
    header: 'Miktar',
    cell: ({ row }) => (
      <span className="text-body-md-medium whitespace-nowrap">
        {formatDecimal(row.original.quantity)} {row.original.baseUnit}
      </span>
    ),
    meta: { className: 'text-right tabular-nums' },
  }),
  column.accessor('minStock', {
    header: 'Kritik stok',
    cell: ({ row }) =>
      row.original.minStock === null ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <span className="whitespace-nowrap">
          {formatDecimal(row.original.minStock)} {row.original.baseUnit}
        </span>
      ),
    meta: { className: 'text-right tabular-nums' },
  }),
  column.accessor('belowMinimum', {
    header: 'Durum',
    // Renk tek başına anlam taşımaz: rozetin metni durumu söyler (docs/tasarim.md).
    cell: ({ row }) =>
      row.original.belowMinimum ? (
        <Badge variant="critical">Kritik</Badge>
      ) : row.original.minStock !== null ? (
        <Badge variant="applied">Yeterli</Badge>
      ) : (
        <span className="text-text-subtle">—</span>
      ),
  }),
  column.accessor('averageCost', {
    header: 'Ort. maliyet',
    cell: ({ row }) => <span className="whitespace-nowrap">{formatDecimal(row.original.averageCost)} TL</span>,
    meta: { className: 'text-right tabular-nums' },
  }),
  column.display({
    id: 'movements',
    header: () => <span className="sr-only">Hareketler</span>,
    cell: ({ row }) => (
      <Link
        href={`/products/${row.original.productId}`}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        aria-label={`${row.original.name}: hareket geçmişi`}
      >
        <ClockArrowDown aria-hidden />
        Hareketler
      </Link>
    ),
    meta: { className: 'w-0 text-right' },
  }),
]);

/** Depo bazında stok. Çalışan yalnızca yetkili olduğu depoları görür (API'de de denetlenir). */
export function StockList(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Stok"
        description="Depo bazında ürün miktarları. Stok yalnızca onaylanan işlemlerle değişir."
        actions={
          <Link href="/operations/new" className={buttonVariants()}>
            <Plus aria-hidden />
            Yeni stok işlemi
          </Link>
        }
      />
      <OrganizationGate>{() => <StockFilters />}</OrganizationGate>
    </>
  );
}

function StockFilters(): JSX.Element {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const selected = warehouses.permitted.some((warehouse) => warehouse.id === warehouseId)
    ? warehouseId
    : (warehouses.permitted[0]?.id ?? '');

  if (warehouses.isPending) {
    return (
      <p aria-live="polite" className="text-text-muted">
        Depolar yükleniyor…
      </p>
    );
  }
  if (warehouses.error) {
    return <Alert>{warehouses.error}</Alert>;
  }
  if (!selected) {
    return <Alert>Stoğunu görebileceğin bir depo yok. Yöneticin Üyeler ekranından sana depo yetkisi verebilir.</Alert>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Field id="stock-warehouse" label="Depo" className="w-full sm:w-64">
          <NativeSelect id="stock-warehouse" value={selected} onChange={(event) => setWarehouseId(event.target.value)}>
            {warehouses.permitted.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.isActive ? warehouse.name : `${warehouse.name} (pasif)`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="stock-search" label="Ara" className="w-full sm:max-w-sm">
          <SearchInput
            id="stock-search"
            placeholder="Ad, SKU, barkod ya da alternatif ad"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
      </div>
      {/* Depo ya da arama değişince sayfalama baştan başlar. */}
      <WarehouseStockTable key={`${selected}:${debouncedSearch}`} warehouseId={selected} search={debouncedSearch} />
    </div>
  );
}

function WarehouseStockTable({ warehouseId, search }: { warehouseId: string; search: string }): JSX.Element {
  const { $api } = useApi();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const query = $api.useQuery(
    'get',
    '/v1/warehouses/{warehouseId}/stock',
    {
      params: {
        path: { warehouseId },
        query: { search: search || undefined, page: pagination.pageIndex + 1, pageSize: pagination.pageSize },
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
        Stok yükleniyor…
      </p>
    );
  }
  return (
    <DataTable
      label={`${query.data.warehouse.name} stoğu`}
      columns={stockColumns}
      data={query.data.items}
      getRowId={(level) => level.productId}
      emptyMessage={search ? 'Aramaya uyan ürün yok.' : 'Bu şirkette henüz aktif ürün yok.'}
      pagination={{ state: pagination, onChange: setPagination, rowCount: query.data.total }}
      isFetching={query.isPlaceholderData}
    />
  );
}
