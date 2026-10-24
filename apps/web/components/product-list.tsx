'use client';

import { recordStatusFilterSchema } from '@ambarci/shared';
import type { Product, RecordStatusFilter } from '@ambarci/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import type { PaginationState } from '@tanstack/react-table';
import { Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { useOrganizations } from '@/components/organization-provider';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { RecordStatusBadge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumns, dataTableFeatures } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { errorMessage } from '@/lib/api-client';
import { formatDecimal } from '@/lib/format';
import { RECORD_STATUS_LABELS } from '@/lib/labels';
import { useDebouncedValue } from '@/lib/use-debounced-value';

const PAGE_SIZE = 25;

const column = createColumnHelper<typeof dataTableFeatures, Product>();

// Kolonlar modül düzeyinde: her çizimde yeni dizi verilirse tablo modelini boşuna baştan kurar.
const productColumns: DataTableColumns<Product> = column.columns([
  column.accessor('sku', {
    header: 'SKU',
    cell: (info) => <span className="text-body-md-medium tabular-nums">{info.getValue()}</span>,
  }),
  column.accessor('name', {
    header: 'Ürün',
    cell: ({ row }) => (
      <div className="flex min-w-48 flex-col">
        <span className="text-body-md-medium">{row.original.name}</span>
        {row.original.aliases.length > 0 ? (
          <span className="text-label-md font-normal text-text-muted">{row.original.aliases.join(', ')}</span>
        ) : null}
      </div>
    ),
  }),
  column.accessor('baseUnit', { header: 'Ana birim' }),
  column.accessor('units', {
    header: 'Ek birimler',
    cell: ({ row }) =>
      row.original.units.length > 0 ? (
        <ul className="tabular-nums">
          {row.original.units.map((unit) => (
            <li key={unit.unit} className="whitespace-nowrap">
              1 {unit.unit} = {formatDecimal(unit.factor)} {row.original.baseUnit}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-text-subtle">—</span>
      ),
  }),
  column.accessor('barcode', {
    header: 'Barkod',
    cell: (info) => <span className="tabular-nums">{info.getValue() ?? '—'}</span>,
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
  column.accessor('isActive', {
    header: 'Durum',
    cell: (info) => <RecordStatusBadge isActive={info.getValue()} />,
  }),
]);

const adminProductColumns: DataTableColumns<Product> = [
  ...productColumns,
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">İşlemler</span>,
    cell: ({ row }) => (
      <Link
        href={`/products/${row.original.id}`}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        aria-label={`${row.original.name} ürününü düzenle`}
      >
        <Pencil aria-hidden />
        Düzenle
      </Link>
    ),
    meta: { className: 'w-0 text-right' },
  }),
];

/** Ürünler: arama, durum süzgeci ve sayfalama sunucuda. Ekleme ve düzenleme yalnızca yöneticiye görünür. */
export function ProductList(): JSX.Element {
  const { active } = useOrganizations();
  const canEdit = active?.role === 'ADMIN';
  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Stok kartları, ek birimleri ve sahada kullanılan adları."
        actions={
          canEdit ? (
            <Link href="/products/new" className={buttonVariants()}>
              <Plus aria-hidden />
              Yeni ürün
            </Link>
          ) : null
        }
      />
      <OrganizationGate>{() => <ProductTable canEdit={canEdit} />}</OrganizationGate>
    </>
  );
}

function ProductTable({ canEdit }: { canEdit: boolean }): JSX.Element {
  const { $api } = useApi();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RecordStatusFilter>('active');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const debouncedSearch = useDebouncedValue(search.trim());

  const query = $api.useQuery(
    'get',
    '/v1/products',
    {
      params: {
        query: {
          search: debouncedSearch || undefined,
          status,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
        },
      },
    },
    // Yeni sayfa ya da arama sonucu gelene kadar önceki sonuç ekranda kalır; tablo boşalıp dolmaz.
    { placeholderData: keepPreviousData },
  );

  // Süzgeç değişince ilk sayfaya dönülür; aksi hâlde 3. sayfadayken yapılan arama boş sayfa gösterebilirdi.
  function resetPage(): void {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Field id="product-search" label="Ara" className="w-full sm:max-w-sm">
          <SearchInput
            id="product-search"
            placeholder="Ad, SKU, barkod ya da alternatif ad"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setSearch(event.target.value);
              resetPage();
            }}
          />
        </Field>
        <Field id="product-status" label="Durum" className="w-40">
          <NativeSelect
            id="product-status"
            value={status}
            onChange={(event) => {
              setStatus(recordStatusFilterSchema.parse(event.target.value));
              resetPage();
            }}
          >
            {recordStatusFilterSchema.options.map((option) => (
              <option key={option} value={option}>
                {RECORD_STATUS_LABELS[option]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {query.isError ? <Alert>{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? (
        <p aria-live="polite" className="text-text-muted">
          Ürünler yükleniyor…
        </p>
      ) : query.data ? (
        <DataTable
          label="Ürünler"
          columns={canEdit ? adminProductColumns : productColumns}
          data={query.data.items}
          getRowId={(product) => product.id}
          emptyMessage={debouncedSearch ? 'Aramaya uyan ürün yok.' : 'Bu listede ürün yok.'}
          pagination={{ state: pagination, onChange: setPagination, rowCount: query.data.total }}
          isFetching={query.isPlaceholderData}
        />
      ) : null}
    </div>
  );
}
