'use client';

import type { CriticalStockItem, RecentMovement } from '@ambarci/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowLeftRight, ChevronRight, ClipboardCheck, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { useApi } from '@/components/api-provider';
import { CreateOrganizationForm } from '@/components/create-organization-form';
import { JoinOrganizationForm } from '@/components/join-organization-form';
import { OrganizationGate } from '@/components/organization-gate';
import { useOrganizations } from '@/components/organization-provider';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumns, dataTableFeatures } from '@/components/ui/data-table';
import { usePendingCount } from '@/components/use-pending-count';
import { errorMessage } from '@/lib/api-client';
import { formatDecimal } from '@/lib/format';
import { formatDateTime, MOVEMENT_TYPE_LABELS, ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

// Gösterge paneli (#87, docs/tasarim.md ekran 3): onay bekleyen işlem sayısı, kritik stoktaki ürünler (depo bazında) ve
// son hareketler. Hepsi yalnızca okur; çalışan yalnızca yetkili olduğu depoları görür (API'de). Tasarımdaki "son 14
// gün" grafiği, stok değeri, asistan özeti ve "Sipariş Aç" bu işin kapsamında değil (docs/tasarim.md "Tasarımdan
// alınmayacaklar").

const RECENT_MOVEMENTS = 10;
const CRITICAL_SHOWN = 20;

export function Dashboard(): JSX.Element {
  const { status, active } = useOrganizations();

  if (status === 'ready' && !active) {
    return (
      <>
        <PageHeader title="Hoş geldin" description="Başlamak için şirketini kur ya da yöneticinden aldığın davet koduyla katıl." />
        <div className="grid gap-4 md:grid-cols-2">
          <CreateOrganizationForm />
          <JoinOrganizationForm />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Gösterge paneli"
        description={active ? `${active.name} · ${ROLE_LABELS[active.role]}` : undefined}
        actions={
          active ? (
            <Link href="/operations/new" className={buttonVariants()}>
              <ArrowLeftRight aria-hidden />
              Yeni stok işlemi
            </Link>
          ) : null
        }
      />
      <OrganizationGate>
        {() => (
          <>
            <DashboardBody />
            <details className="rounded-lg border border-border bg-card p-4 shadow-1">
              <summary className="cursor-pointer text-body-md-medium text-primary">
                Başka bir şirkete katıl ya da yeni şirket kur
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <JoinOrganizationForm />
                <CreateOrganizationForm />
              </div>
            </details>
          </>
        )}
      </OrganizationGate>
    </>
  );
}

function DashboardBody(): JSX.Element {
  const { $api } = useApi();
  const pending = usePendingCount();
  const critical = $api.useQuery('get', '/v1/stock/critical', { params: { query: { page: 1, pageSize: CRITICAL_SHOWN } } });

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <KpiTile
          title="Onay bekleyen işlem"
          icon={ClipboardCheck}
          value={pending.count}
          error={pending.error ? errorMessage(pending.error) : null}
          tone="pending"
          badge={pending.count ? 'Onay bekliyor' : null}
          note="Onaylanana kadar stok değişmez."
          href="/approvals"
          linkLabel="Onay kuyruğuna git"
        />
        <KpiTile
          title="Kritik stoktaki ürün"
          icon={TriangleAlert}
          value={critical.data?.total ?? null}
          error={critical.isError ? errorMessage(critical.error) : null}
          tone="critical"
          badge={critical.data?.total ? 'Eşik altı' : null}
          note="Depo bazında sayılır: bir ürün iki depoda eşiğin altındaysa iki kez."
          href="/stock"
          linkLabel="Stok sayfasına git"
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentMovements />
        </div>
        <CriticalStock
          items={critical.data?.items ?? null}
          total={critical.data?.total ?? 0}
          error={critical.isError ? errorMessage(critical.error) : null}
        />
      </div>
    </>
  );
}

/** Büyük sayılı kutu (headline-lg); renk tek başına anlam taşımaz, yanında rozet ve açıklama vardır. */
function KpiTile({
  title,
  icon: Icon,
  value,
  error,
  tone,
  badge,
  note,
  href,
  linkLabel,
}: {
  title: string;
  icon: LucideIcon;
  value: number | null;
  error: string | null;
  tone: 'pending' | 'critical';
  badge: string | null;
  note: string;
  href: string;
  linkLabel: string;
}): JSX.Element {
  return (
    <Card className={cn('gap-3', value ? (tone === 'pending' ? 'border-pending-border' : 'border-critical-border') : null)}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-title-md text-text">{title}</h2>
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-md',
            tone === 'pending' ? 'bg-pending-soft text-pending' : 'bg-critical-soft text-critical',
          )}
        >
          <Icon aria-hidden className="size-5" />
        </span>
      </div>
      {error ? (
        <Alert>{error}</Alert>
      ) : (
        <p className="flex items-center gap-3" aria-live="polite">
          <span
            className={cn(
              'text-headline-lg tabular-nums',
              value ? (tone === 'pending' ? 'text-pending' : 'text-critical') : 'text-text',
            )}
          >
            {value === null ? '…' : value}
          </span>
          {badge ? <Badge variant={tone}>{badge}</Badge> : null}
        </p>
      )}
      <p className="text-body-md text-text-muted">{note}</p>
      <Link
        href={href}
        className="flex items-center gap-1 self-start rounded-md text-label-md text-primary-action hover:underline focus-visible:outline-2 focus-visible:outline-primary-action"
      >
        {linkLabel}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </Card>
  );
}

const movementColumn = createColumnHelper<typeof dataTableFeatures, RecentMovement>();

const movementColumns: DataTableColumns<RecentMovement> = movementColumn.columns([
  movementColumn.accessor('createdAt', {
    header: 'Tarih',
    cell: (info) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(info.getValue())}</span>,
  }),
  movementColumn.accessor((movement) => movement.product.name, {
    id: 'product',
    header: 'Ürün',
    cell: ({ row }) => (
      <Link href={`/products/${row.original.product.id}`} className="flex flex-col hover:underline">
        <span className="text-body-md-medium text-text">{row.original.product.name}</span>
        <span className="text-label-md font-normal text-text-muted tabular-nums">{row.original.product.sku}</span>
      </Link>
    ),
  }),
  movementColumn.accessor('type', { header: 'Hareket', cell: (info) => MOVEMENT_TYPE_LABELS[info.getValue()] }),
  movementColumn.accessor('quantityChange', {
    header: 'Değişim',
    // İşaret metnin içinde (+ / −): renk tek başına yönü anlatmaz.
    cell: ({ row }) => (
      <span
        className={cn(
          'whitespace-nowrap text-body-md-medium',
          row.original.quantityChange.startsWith('-') ? 'text-critical' : 'text-applied',
        )}
      >
        {formatDecimal(row.original.quantityChange, { signed: true })} {row.original.product.baseUnit}
      </span>
    ),
    meta: { className: 'text-right tabular-nums' },
  }),
  movementColumn.accessor((movement) => movement.warehouse.name, { id: 'warehouse', header: 'Depo' }),
  movementColumn.display({
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

/** Şirketin son hareketleri (onaylanmış işlemlerin yazdığı); çalışan yalnızca yetkili olduğu depolarınkini görür. */
function RecentMovements(): JSX.Element {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/movements', { params: { query: { page: 1, pageSize: RECENT_MOVEMENTS } } });

  let content: ReactNode;
  if (query.isError) {
    content = <Alert>{errorMessage(query.error)}</Alert>;
  } else if (query.isPending) {
    content = (
      <p aria-live="polite" className="text-text-muted">
        Hareketler yükleniyor…
      </p>
    );
  } else {
    content = (
      <DataTable
        label="Son hareketler"
        columns={movementColumns}
        data={query.data.items}
        getRowId={(movement) => movement.id}
        emptyMessage="Henüz stok hareketi yok. Hareket, bir işlem onaylanınca yazılır."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Son hareketler</CardTitle>
        <CardDescription>
          {query.data && query.data.total > query.data.items.length
            ? `Toplam ${query.data.total} hareketten en yeni ${query.data.items.length} tanesi. Ürünün bütün geçmişi ürün sayfasında.`
            : 'Onaylanan işlemlerin yazdığı stok hareketleri, en yeni önce.'}
        </CardDescription>
      </CardHeader>
      {content}
    </Card>
  );
}

/** Kritik stok, depo bazında: API depo adına, sonra en ağır eksiğe göre sıralar; burada depolara bölünür. */
function CriticalStock({
  items,
  total,
  error,
}: {
  items: CriticalStockItem[] | null;
  total: number;
  error: string | null;
}): JSX.Element {
  const groups = new Map<string, { name: string; items: CriticalStockItem[] }>();
  for (const item of items ?? []) {
    const group = groups.get(item.warehouse.id) ?? { name: item.warehouse.name, items: [] };
    group.items.push(item);
    groups.set(item.warehouse.id, group);
  }

  let content: ReactNode;
  if (error) {
    content = <Alert>{error}</Alert>;
  } else if (!items) {
    content = (
      <p aria-live="polite" className="text-text-muted">
        Kritik stok yükleniyor…
      </p>
    );
  } else if (items.length === 0) {
    content = <p className="text-text-muted">Eşiğin altına düşen ürün yok.</p>;
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {[...groups.entries()].map(([warehouseId, group]) => (
          <section key={warehouseId} aria-labelledby={`critical-${warehouseId}`} className="flex flex-col gap-1">
            <h3 id={`critical-${warehouseId}`} className="text-label-sm uppercase text-text-muted">
              {group.name}
            </h3>
            <ul className="flex flex-col divide-y divide-divider">
              {group.items.map((item) => (
                <li key={`${warehouseId}:${item.product.id}`}>
                  <Link
                    href={`/products/${item.product.id}`}
                    className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary-action"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body-md-medium text-text">{item.product.name}</span>
                      <span className="text-label-md font-normal text-text-muted tabular-nums">{item.product.sku}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1 text-right">
                      <Badge variant="critical">Kritik</Badge>
                      <span className="whitespace-nowrap text-body-md tabular-nums">
                        <span className="text-body-md-medium text-critical">
                          Kalan {formatDecimal(item.quantity)} {item.product.baseUnit}
                        </span>{' '}
                        <span className="text-text-muted">
                          (eşik {formatDecimal(item.minStock)} {item.product.baseUnit})
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {total > items.length ? (
          <p className="text-text-muted">
            Toplam {total} satırdan {items.length} tanesi gösteriliyor. Depo seçerek Stok sayfasında hepsine bakabilirsiniz.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kritik stok</CardTitle>
        <CardDescription>Ürünün kritik stok eşiğinin altına düştüğü depolar.</CardDescription>
      </CardHeader>
      {content}
    </Card>
  );
}
