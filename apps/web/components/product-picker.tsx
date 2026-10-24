'use client';

import type { Product } from '@ambarci/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { SearchInput } from '@/components/ui/search-input';
import { errorMessage } from '@/lib/api-client';
import { formatDecimal } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';

const RESULT_LIMIT = 10;

/**
 * Fiş kalemine ürün seçme penceresi: ad, SKU, barkod ya da alternatif adda arama (Türkçe I/İ farkı gözetmez).
 * Yalnızca aktif ürünler listelenir; pasif ürün yeni işlemde kullanılamaz.
 */
export function ProductPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (product: Product) => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ürün seç</DialogTitle>
            <DialogDescription>Ad, SKU, barkod ya da sahada kullanılan adla ara.</DialogDescription>
          </DialogHeader>
          <ProductSearch onSelect={onSelect} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function ProductSearch({ onSelect }: { onSelect: (product: Product) => void }): JSX.Element {
  const { $api } = useApi();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const query = $api.useQuery(
    'get',
    '/v1/products',
    { params: { query: { search: debouncedSearch || undefined, status: 'active', pageSize: RESULT_LIMIT } } },
    { placeholderData: keepPreviousData },
  );

  return (
    <div className="flex flex-col gap-3">
      <Field id="product-picker-search" label="Ara">
        <SearchInput
          id="product-picker-search"
          autoFocus
          value={search}
          maxLength={100}
          placeholder="ör. priz, PRZ-TOP-B, yangın kablosu"
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
      {query.isError ? <Alert>{errorMessage(query.error)}</Alert> : null}
      {query.isPending ? (
        <p aria-live="polite" className="text-text-muted">
          Ürünler yükleniyor…
        </p>
      ) : query.data ? (
        <>
          {query.data.items.length === 0 ? (
            <p className="text-text-muted">Aramaya uyan aktif ürün yok.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider rounded-md border border-border" aria-label="Arama sonuçları">
              {query.data.items.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(product)}
                    className="flex min-h-14 w-full cursor-pointer flex-col items-start justify-center px-4 py-2 text-left hover:bg-primary-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-action"
                  >
                    <span className="text-body-md-medium text-text">{product.name}</span>
                    <span className="text-label-md font-normal text-text-muted tabular-nums">
                      {product.sku} · {product.baseUnit}
                      {product.units.length > 0
                        ? ` · ${product.units.map((unit) => `1 ${unit.unit} = ${formatDecimal(unit.factor)} ${product.baseUnit}`).join(', ')}`
                        : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.data.total > query.data.items.length ? (
            <p className="text-label-md font-normal text-text-muted">
              İlk {query.data.items.length} sonuç gösteriliyor ({query.data.total} ürün); aramayı daraltın.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
