'use client';

import { approvalDeadline, bulkConfirmSummary, confirmEach, nextDeadline, randomUuid } from '@ambarci/api-client';
import type { BulkConfirmOutcome, CardConfirmKey } from '@ambarci/api-client';
import { operationTypeSchema } from '@ambarci/shared';
import type { ActionSource, OperationSummary, OperationType } from '@ambarci/shared';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import type { OnChangeFn, PaginationState } from '@tanstack/react-table';
import { CheckCheck, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import type { DataTableColumns, dataTableFeatures } from '@/components/ui/data-table';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Checkbox, NativeSelect } from '@/components/ui/input';
import { refreshOperationQueries } from '@/components/use-operation-actions';
import { useWarehouses } from '@/components/use-warehouses';
import { errorMessage } from '@/lib/api-client';
import { ACTION_SOURCE_LABELS, formatDateTime, OPERATION_TYPE_LABELS } from '@/lib/labels';
import { useNow } from '@/lib/use-now';

// Onay kuyruğu (#87): onay bekleyen işlemler, süzgeç, sayfalama ve toplu onay. Stok yalnızca onay ucunda değişir
// (mimari değişmez 2); toplu onay için ayrı bir uç yoktur, seçilen her işlem kendi onay isteği ve kendi
// Idempotency-Key'iyle gider (packages/api-client/src/bulk-confirm.ts). Çalışan yalnızca bütün depolarında yetkili
// olduğu işlemleri görür; süresi dolmuş sohbet önerisi listeye gelmez (ikisi de API'de).

const PAGE_SIZE = 25;
const NO_ITEMS: OperationSummary[] = [];

/** Kaynak süzgeci: sohbet, ekran, içe aktarma ve (7. haftada) belge. Sistemin açtığı işlemler "Tümü"nde görünür. */
const SOURCE_FILTERS: { value: ActionSource | ''; label: string }[] = [
  { value: '', label: 'Tümü' },
  { value: 'CHAT', label: ACTION_SOURCE_LABELS.CHAT },
  { value: 'SCREEN', label: ACTION_SOURCE_LABELS.SCREEN },
  { value: 'IMPORT', label: ACTION_SOURCE_LABELS.IMPORT },
  { value: 'DOCUMENT', label: ACTION_SOURCE_LABELS.DOCUMENT },
];

interface QueueFilters {
  type: OperationType | '';
  warehouseId: string;
  source: ActionSource | '';
}

const NO_FILTERS: QueueFilters = { type: '', warehouseId: '', source: '' };

/** Toplu onayın bir satırı: işlemin gönderildiği andaki özeti ve sonucu (uygulanan işlem listeden düşer). */
interface BulkResultRow {
  operation: OperationSummary;
  outcome: BulkConfirmOutcome;
}

const column = createColumnHelper<typeof dataTableFeatures, OperationSummary>();

function warehouseNames(operation: OperationSummary): string {
  return operation.warehouses.map((warehouse) => warehouse.name).join(', ');
}

function creatorOf(operation: OperationSummary): string {
  if (!operation.createdBy) {
    return 'Sistem';
  }
  return operation.createdBy.email ?? 'Bilinmeyen kullanıcı';
}

export function ApprovalQueue(): JSX.Element {
  return (
    <>
      <PageHeader
        title="Onay kuyruğu"
        description="Onay bekleyen işlemler. Onaylanana kadar stok değişmez; toplu onayda her işlem ayrı onaylanır."
      />
      <OrganizationGate>{(organization) => <QueueBody isAdmin={organization.role === 'ADMIN'} />}</OrganizationGate>
    </>
  );
}

function QueueBody({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const warehouses = useWarehouses();
  const [filters, setFilters] = useState<QueueFilters>(NO_FILTERS);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PAGE_SIZE });
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<BulkResultRow[] | null>(null);
  // İşlem başına son onay anahtarı, sayfa açık kaldıkça: ağ hatasından sonra aynı işlem aynı sürümle yeniden
  // gönderilirse aynı anahtar gider ve API ilk isteği tanır (stok bir kez değişir).
  const keys = useRef(new Map<string, CardConfirmKey>());
  const confirmMutation = $api.useMutation('post', '/v1/operations/{operationId}/confirm');

  const query = $api.useQuery(
    'get',
    '/v1/operations',
    {
      params: {
        query: {
          status: 'PENDING_CONFIRMATION',
          type: filters.type || undefined,
          source: filters.source || undefined,
          warehouseId: filters.warehouseId || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
        },
      },
    },
    // Başka bir kullanıcının ya da sohbetin açtığı işlem de görünsün diye dakikada bir yeniden okunur.
    { placeholderData: keepPreviousData, refetchInterval: 60_000 },
  );
  const items = query.data?.items ?? NO_ITEMS;
  const running = progress !== null;

  // Kalan süre yarım dakikada bir güncellenir; en yakın son onay anı gelince liste yeniden okunur ve süresi dolan
  // öneri listeden düşer (API onu artık onay bekleyen saymaz).
  const now = useNow(30_000, items.some((item) => item.expiresAt !== null));
  const { refetch } = query;
  useEffect(() => {
    const next = nextDeadline(
      items.map((item) => item.expiresAt),
      new Date(),
    );
    if (!next) {
      return undefined;
    }
    const timer = setTimeout(() => void refetch(), next.getTime() - Date.now() + 1_000);
    return () => clearTimeout(timer);
  }, [items, refetch]);

  const selectable = useMemo(() => items.filter((item) => !approvalDeadline(item.expiresAt, now).expired), [items, now]);
  const chosen = useMemo(() => selectable.filter((item) => selected.has(item.id)), [selectable, selected]);

  function changeFilters(next: Partial<QueueFilters>): void {
    setFilters((current) => ({ ...current, ...next }));
    setPagination((current) => ({ ...current, pageIndex: 0 }));
    setSelected(new Set());
  }

  // Seçim yalnızca görünen sayfadadır: sayfa değişince temizlenir, kullanıcı görmediği işlemi onaylamaz.
  const changePage: OnChangeFn<PaginationState> = (updater) => {
    setPagination(updater);
    setSelected(new Set());
  };

  const columns = useMemo<DataTableColumns<OperationSummary>>(() => {
    const allChosen = selectable.length > 0 && selectable.every((item) => selected.has(item.id));
    const someChosen = selectable.some((item) => selected.has(item.id));
    const toggle = (id: string): void =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    return column.columns([
      column.display({
        id: 'select',
        header: () => (
          <Checkbox
            aria-label="Sayfadaki bütün işlemleri seç"
            checked={allChosen}
            ref={(element) => {
              if (element) {
                element.indeterminate = someChosen && !allChosen;
              }
            }}
            disabled={running || selectable.length === 0}
            onChange={() => setSelected(allChosen ? new Set() : new Set(selectable.map((item) => item.id)))}
          />
        ),
        cell: ({ row }) => {
          const expired = approvalDeadline(row.original.expiresAt, now).expired;
          return (
            <Checkbox
              aria-label={`${OPERATION_TYPE_LABELS[row.original.type]} işlemini seç (${formatDateTime(row.original.createdAt)})`}
              checked={!expired && selected.has(row.original.id)}
              disabled={running || expired}
              onChange={() => toggle(row.original.id)}
            />
          );
        },
        meta: { className: 'w-0' },
      }),
      column.accessor('type', {
        header: 'Tür',
        cell: (info) => <span className="text-body-md-medium">{OPERATION_TYPE_LABELS[info.getValue()]}</span>,
      }),
      column.accessor('source', {
        header: 'Kaynak',
        cell: (info) => ACTION_SOURCE_LABELS[info.getValue()],
      }),
      column.display({
        id: 'createdBy',
        header: 'Açan',
        cell: ({ row }) => <span className="block max-w-56 truncate">{creatorOf(row.original)}</span>,
      }),
      column.display({
        id: 'warehouses',
        header: 'Depolar',
        cell: ({ row }) => warehouseNames(row.original),
      }),
      column.accessor('lineCount', {
        header: 'Kalem',
        meta: { className: 'text-right tabular-nums' },
      }),
      column.accessor('createdAt', {
        header: 'Tarih',
        cell: (info) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(info.getValue())}</span>,
      }),
      column.accessor('expiresAt', {
        header: 'Son onay',
        cell: ({ row }) => {
          const { expiresAt } = row.original;
          const deadline = approvalDeadline(expiresAt, now);
          if (!expiresAt || !deadline.label) {
            return <span className="text-text-subtle">—</span>;
          }
          return (
            <span className="flex flex-col items-start gap-1">
              <Badge variant={deadline.expired ? 'muted' : 'pending'}>{deadline.label}</Badge>
              <span className="whitespace-nowrap text-label-md font-normal text-text-muted tabular-nums">
                {formatDateTime(expiresAt)}
              </span>
            </span>
          );
        },
      }),
      column.display({
        id: 'open',
        header: () => <span className="sr-only">Özet</span>,
        cell: ({ row }) => (
          <Link
            href={`/operations/${row.original.id}`}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            aria-label={`${OPERATION_TYPE_LABELS[row.original.type]} işleminin özetini aç`}
          >
            Özeti aç
            <ChevronRight aria-hidden />
          </Link>
        ),
        meta: { className: 'w-0 text-right' },
      }),
    ]);
  }, [selectable, selected, now, running]);

  async function runBulkConfirm(): Promise<void> {
    // Gönderilen işlemlerin o anki hâli: uygulananlar listeden düşse de sonuçta türü ve depoları görünsün.
    const batch = chosen;
    setConfirmOpen(false);
    setResults(null);
    setProgress({ done: 0, total: batch.length });
    const outcomes = await confirmEach(
      batch.map((operation) => ({ id: operation.id, version: operation.version })),
      {
        confirm: (target, idempotencyKey) =>
          confirmMutation.mutateAsync({
            params: { path: { operationId: target.id }, header: { 'Idempotency-Key': idempotencyKey } },
            body: { version: target.version },
          }),
        keys: keys.current,
        makeKey: randomUuid,
        onProgress: (_outcome, done, total) => setProgress({ done, total }),
      },
    );
    const byId = new Map(batch.map((operation) => [operation.id, operation]));
    setResults(
      outcomes.flatMap((outcome) => {
        const operation = byId.get(outcome.operationId);
        return operation ? [{ operation, outcome }] : [];
      }),
    );
    setSelected(new Set());
    setProgress(null);
    // Uygulanan, süresi dolan ya da değişen işlemlerin yeni hâli; stok, hareketler ve gösterge paneli de eskidi.
    await refreshOperationQueries(queryClient);
  }

  const typeOptions = operationTypeSchema.options.filter((type) => isAdmin || type !== 'OPENING');
  const filtered = filters.type !== '' || filters.source !== '' || filters.warehouseId !== '';

  return (
    <div className="flex flex-col gap-4">
      {results ? <BulkResults results={results} onClose={() => setResults(null)} /> : null}

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-1">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-body-md-medium text-text">Kaynak</legend>
          <div className="flex flex-wrap gap-2">
            {SOURCE_FILTERS.map((option) => (
              <label key={option.value || 'all'} className="cursor-pointer">
                <input
                  type="radio"
                  name="queue-source"
                  value={option.value}
                  checked={filters.source === option.value}
                  onChange={() => changeFilters({ source: option.value })}
                  disabled={running}
                  className="peer sr-only"
                />
                <span className="flex min-h-10 items-center rounded-full border border-border-strong bg-card px-4 text-label-md text-primary peer-checked:border-primary peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-action peer-disabled:opacity-50">
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-start gap-3">
          <Field id="queue-type" label="Tür" className="w-full sm:w-56">
            <NativeSelect
              id="queue-type"
              value={filters.type}
              disabled={running}
              onChange={(event) => {
                const parsed = operationTypeSchema.safeParse(event.target.value);
                changeFilters({ type: parsed.success ? parsed.data : '' });
              }}
            >
              <option value="">Bütün türler</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {OPERATION_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="queue-warehouse" label="Depo" className="w-full sm:w-64">
            <NativeSelect
              id="queue-warehouse"
              value={filters.warehouseId}
              disabled={running || warehouses.isPending}
              onChange={(event) => changeFilters({ warehouseId: event.target.value })}
            >
              <option value="">Bütün depolar</option>
              {warehouses.permitted.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.isActive ? warehouse.name : `${warehouse.name} (pasif)`}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4">
          <p aria-live="polite" className="text-body-md-medium text-text tabular-nums">
            {progress
              ? `Onaylanıyor: ${progress.done} / ${progress.total}`
              : chosen.length > 0
                ? `${chosen.length} işlem seçili`
                : 'Toplu onay için işlem seçin.'}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            {chosen.length > 0 && !running ? (
              <Button variant="secondary" onClick={() => setSelected(new Set())}>
                Seçimi temizle
              </Button>
            ) : null}
            <Button disabled={chosen.length === 0 || running} onClick={() => setConfirmOpen(true)}>
              <CheckCheck aria-hidden />
              {running ? 'Onaylanıyor…' : 'Seçilenleri onayla'}
            </Button>
          </div>
        </div>
      </div>

      {query.isError ? (
        <Alert>{errorMessage(query.error)}</Alert>
      ) : query.isPending ? (
        <p aria-live="polite" className="text-text-muted">
          Onay bekleyen işlemler yükleniyor…
        </p>
      ) : (
        <DataTable
          label="Onay bekleyen işlemler"
          columns={columns}
          data={items}
          getRowId={(operation) => operation.id}
          emptyMessage={filtered ? 'Süzgece uyan onay bekleyen işlem yok.' : 'Onay bekleyen işlem yok.'}
          pagination={{ state: pagination, onChange: changePage, rowCount: query.data.total }}
          isFetching={query.isPlaceholderData}
        />
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{chosen.length} işlemi onayla</DialogTitle>
            <DialogDescription>
              Her işlem ayrı bir onay isteğiyle gönderilir ve stoğu kendi başına değiştirir. Stoğu yetmeyen, süresi dolan
              ya da bu arada değişen işlem uygulanmaz; ötekiler bundan etkilenmez.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-64 flex-col divide-y divide-divider overflow-y-auto rounded-md border border-border">
            {chosen.map((operation) => (
              <li key={operation.id} className="flex flex-wrap gap-x-2 px-3 py-2">
                <span className="text-body-md-medium">{OPERATION_TYPE_LABELS[operation.type]}</span>
                <span className="text-text-muted">
                  {operation.lineCount} kalem · {warehouseNames(operation)} · {formatDateTime(operation.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button onClick={() => void runBulkConfirm()} disabled={chosen.length === 0}>
              <CheckCheck aria-hidden />
              Onayla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Toplu onayın sonucu, işlem işlem: rozet (renk ve metin), açıklama ve özete bağlantı. */
function BulkResults({ results, onClose }: { results: BulkResultRow[]; onClose: () => void }): JSX.Element {
  const outcomes = results.map((row) => row.outcome);
  const retryable = outcomes.some((outcome) => outcome.retryable);
  return (
    <Card aria-labelledby="bulk-results-title">
      <CardHeader>
        <CardTitle id="bulk-results-title">Toplu onay sonucu</CardTitle>
        <CardDescription role="status">{bulkConfirmSummary(outcomes)}</CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y divide-divider">
        {results.map(({ operation, outcome }) => (
          <li key={operation.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Badge variant={outcome.tone}>{outcome.label}</Badge>
            <span className="text-body-md-medium">{OPERATION_TYPE_LABELS[operation.type]}</span>
            <span className="text-text-muted tabular-nums">
              {warehouseNames(operation)} · {formatDateTime(operation.createdAt)}
            </span>
            <Link
              href={`/operations/${operation.id}`}
              className="ml-auto flex items-center gap-1 rounded-md text-label-md text-primary-action hover:underline focus-visible:outline-2 focus-visible:outline-primary-action"
            >
              Özeti aç
              <ChevronRight aria-hidden className="size-4" />
            </Link>
            <p className="w-full text-text-muted">{outcome.message}</p>
          </li>
        ))}
      </ul>
      {retryable ? (
        <p className="text-text-muted">
          Gönderilemeyen işlemleri yeniden seçip onaylayabilirsiniz; aynı işlem aynı anahtarla gider, stok iki kez değişmez.
        </p>
      ) : null}
      <div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Sonucu kapat
        </Button>
      </div>
    </Card>
  );
}
