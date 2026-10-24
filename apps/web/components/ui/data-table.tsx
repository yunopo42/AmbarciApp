'use client';

import { rowPaginationFeature, tableFeatures, useTable } from '@tanstack/react-table';
import type { ColumnDef, OnChangeFn, PaginationState, RowData } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** Kolon başına ek bilgi: başlık ve hücreye birlikte verilen sınıf (ör. sağa yaslama, dar kolon). */
interface DataTableColumnMeta {
  className?: string;
}

/**
 * Liste tablolarının TanStack Table özellikleri. Yalnızca sayfalama kayıtlıdır ve o da elle (manualPagination):
 * arama, süzme ve sayfalama sunucuda yapılır; tablo gelen sayfayı çizer, sayfa sayısını toplam kayıttan hesaplar.
 * Modül düzeyinde tanımlanır; her çizimde yeniden kurulursa tablo modelini boşuna baştan hesaplar.
 */
export const dataTableFeatures = tableFeatures({ rowPaginationFeature, columnMeta: {} as DataTableColumnMeta });

export type DataTableColumns<TData extends RowData> = ColumnDef<typeof dataTableFeatures, TData>[];

/** Sunucu tarafı sayfalama: sayfa durumu çağıran bileşende tutulur ve API sorgusuna da o verir. */
export interface ServerPagination {
  state: PaginationState;
  onChange: OnChangeFn<PaginationState>;
  /** Süzgece uyan bütün kayıtların sayısı (API'nin `total` alanı). */
  rowCount: number;
}

/**
 * shadcn/ui'ın "data table" kalıbı: TanStack Table satır ve kolon modelini üretir, işaretleme ve stil bizde.
 * `pagination` verilmezse bütün satırlar tek sayfada gösterilir (ör. depolar).
 */
export function DataTable<TData extends RowData>({
  label,
  columns,
  data,
  getRowId,
  emptyMessage,
  pagination,
  isFetching = false,
}: {
  /** Tablonun ekran okuyucudaki adı. */
  label: string;
  columns: DataTableColumns<TData>;
  data: TData[];
  getRowId: (row: TData) => string;
  emptyMessage: string;
  pagination?: ServerPagination;
  /** Yeni sayfa yüklenirken önceki sayfa soluk gösterilir. */
  isFetching?: boolean;
}): JSX.Element {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    manualPagination: true,
    rowCount: pagination?.rowCount ?? data.length,
    ...(pagination ? { state: { pagination: pagination.state }, onPaginationChange: pagination.onChange } : {}),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={label} aria-busy={isFetching}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="h-auto border-0">
              {group.headers.map((header) => (
                <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className={cn(isFetching && 'opacity-60')}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center text-text-muted">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {pagination && pagination.rowCount > 0 ? (
        <nav aria-label={`${label}: sayfalar`} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-body-md text-text-muted tabular-nums">{rangeText(pagination)}</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft aria-hidden />
              Önceki
            </Button>
            <span className="text-body-md-medium tabular-nums">
              Sayfa {pagination.state.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Sonraki
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function rangeText({ state, rowCount }: ServerPagination): string {
  const from = state.pageIndex * state.pageSize + 1;
  const to = Math.min(rowCount, (state.pageIndex + 1) * state.pageSize);
  return `Toplam ${rowCount} kayıttan ${from}–${to} arası gösteriliyor`;
}
