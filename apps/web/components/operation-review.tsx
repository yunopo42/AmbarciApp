'use client';

import { describeApiError } from '@ambarci/api-client';
import type { ConfirmOperationResult, OperationPreview, OperationPreviewLine, OperationStatus, StockEffect } from '@ambarci/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { OrganizationGate } from '@/components/organization-gate';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage } from '@/lib/api-client';
import { formatDecimal } from '@/lib/format';
import { formatDateTime, MOVEMENT_TYPE_LABELS, OPERATION_STATUS_LABELS, OPERATION_TYPE_LABELS } from '@/lib/labels';

/** Yetersiz stok hatasının (409 INSUFFICIENT_STOCK) kalem ayrıntısı; miktarlar ana birimde. */
interface Shortage {
  lineNo: number;
  requested: string;
  available: string;
}

function isShortage(value: unknown): value is Shortage {
  const candidate = value as Partial<Shortage> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.lineNo === 'number' &&
    typeof candidate.requested === 'string' &&
    typeof candidate.available === 'string'
  );
}

const STATUS_BADGE: Partial<Record<OperationStatus, 'pending' | 'applied' | 'muted'>> = {
  PENDING_CONFIRMATION: 'pending',
  APPLIED: 'applied',
  CANCELLED: 'muted',
};

/**
 * İşlemin özeti ve onayı. Stoğun önceki ve sonraki hâli sunucuda hesaplanır (GET …/preview). Stok yalnızca "Onayla"
 * ile, onay uç noktasında değişir (mimari değişmez 2).
 */
export function OperationReview({ operationId }: { operationId: string }): JSX.Element {
  return <OrganizationGate>{() => <ReviewBody operationId={operationId} />}</OrganizationGate>;
}

function ReviewBody({ operationId }: { operationId: string }): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const previewInit = { params: { path: { operationId } } };
  const query = $api.useQuery('get', '/v1/operations/{operationId}/preview', previewInit);
  const confirm = $api.useMutation('post', '/v1/operations/{operationId}/confirm');
  const cancel = $api.useMutation('post', '/v1/operations/{operationId}/cancel');
  // Bu ekrandaki bütün onay denemeleri aynı anahtarı taşır. Çift tıklamada ya da ağ hatasından sonra tekrar
  // denendiğinde API işlemi uygulanmış ve anahtarı aynı bulur, ilk cevabı döner: stok ikinci kez değişmez.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [shortages, setShortages] = useState<Map<number, Shortage>>(() => new Map());
  const [result, setResult] = useState<ConfirmOperationResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = confirm.isPending || cancel.isPending;

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: $api.queryOptions('get', '/v1/operations/{operationId}/preview', previewInit).queryKey,
      }),
      // Stok listesi, hareket geçmişi ve onay bekleyen işlemler bir sonraki açılışta sunucudan yeniden okunur.
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/operations'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/warehouses/{warehouseId}/stock'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/products/{productId}/movements'] }),
    ]);
  }

  async function handleConfirm(preview: OperationPreview): Promise<void> {
    setActionError(null);
    setShortages(new Map());
    try {
      const confirmed = await confirm.mutateAsync({
        params: { path: { operationId }, header: { 'Idempotency-Key': idempotencyKey } },
        body: { version: preview.version },
      });
      setResult(confirmed);
    } catch (reason) {
      const failure = describeApiError(reason);
      if (failure.code === 'INSUFFICIENT_STOCK' && Array.isArray(failure.details)) {
        setShortages(new Map(failure.details.filter(isShortage).map((shortage) => [shortage.lineNo, shortage])));
      }
      setActionError(failure.message);
    }
    // Başarıda durum, hatada güncel stok (arada başka bir işlem onaylanmış olabilir) yeniden okunur.
    await refresh();
  }

  async function handleCancel(): Promise<void> {
    setActionError(null);
    try {
      await cancel.mutateAsync({ params: { path: { operationId } } });
    } catch (reason) {
      setActionError(errorMessage(reason));
    }
    await refresh();
  }

  if (query.isPending) {
    return (
      <p aria-live="polite" className="text-text-muted">
        İşlem yükleniyor…
      </p>
    );
  }
  if (query.isError) {
    return <Alert>{errorMessage(query.error)}</Alert>;
  }

  const preview = query.data;
  const pending = preview.status === 'PENDING_CONFIRMATION';
  const hasShortage = preview.lines.some((line) => line.stock?.sufficient === false || line.targetStock?.sufficient === false);
  const showCost = preview.type === 'STOCK_IN' || preview.type === 'OPENING';
  const statusVariant = STATUS_BADGE[preview.status] ?? 'muted';

  return (
    <>
      <PageHeader
        title={`${OPERATION_TYPE_LABELS[preview.type]} işlemi`}
        description={`Oluşturulma: ${formatDateTime(preview.createdAt)}`}
        actions={<Badge variant={statusVariant}>{OPERATION_STATUS_LABELS[preview.status]}</Badge>}
      />

      {result ? (
        <Alert variant="applied">İşlem onaylandı; stok güncellendi.</Alert>
      ) : preview.status === 'APPLIED' ? (
        <Alert variant="applied">Bu işlem onaylandı.</Alert>
      ) : null}
      {preview.status === 'CANCELLED' ? <p className="text-text-muted">Bu işlem iptal edildi; stok değişmedi.</p> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Kalemler</CardTitle>
          {pending ? (
            <CardDescription>
              Stoğun önceki ve sonraki hâli şu anki stoktan sunucuda hesaplandı. Onay anında stok yeniden okunur.
            </CardDescription>
          ) : null}
        </CardHeader>
        {preview.partyName || preview.note ? (
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
            {preview.partyName ? (
              <>
                <dt className="text-text-muted">Cari</dt>
                <dd className="text-body-md-medium">{preview.partyName}</dd>
              </>
            ) : null}
            {preview.note ? (
              <>
                <dt className="text-text-muted">Not</dt>
                <dd>{preview.note}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        <Table aria-label="İşlem kalemleri">
          <TableHeader>
            <TableRow className="h-auto border-0">
              <TableHead className="w-0">#</TableHead>
              <TableHead>Ürün</TableHead>
              <TableHead className="text-right">{preview.type === 'COUNT' ? 'Sayılan' : 'Miktar'}</TableHead>
              {showCost ? <TableHead className="text-right">Birim maliyet</TableHead> : null}
              <TableHead>Depo</TableHead>
              {pending ? <TableHead>Stok (önce → sonra)</TableHead> : null}
              {pending ? <TableHead>Durum</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.lines.map((line) => (
              <PreviewRow
                key={line.lineNo}
                line={line}
                pending={pending}
                showCost={showCost}
                shortage={shortages.get(line.lineNo)}
              />
            ))}
          </TableBody>
        </Table>
      </Card>

      {pending ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleConfirm(preview)} disabled={busy || hasShortage}>
              {confirm.isPending ? 'Onaylanıyor…' : 'Onayla'}
            </Button>
            <Button variant="secondary" onClick={() => void handleCancel()} disabled={busy}>
              {cancel.isPending ? 'İptal ediliyor…' : 'İptal et'}
            </Button>
            {hasShortage ? (
              // Bu arada depoya giriş yapıldıysa özet yeniden hesaplanır ve onay açılır.
              <Button variant="ghost" onClick={() => void refresh()} disabled={busy || query.isFetching}>
                <RefreshCw aria-hidden />
                Stoğu yeniden oku
              </Button>
            ) : null}
          </div>
          <p className="text-text-muted">
            {hasShortage
              ? 'Stoğu yetmeyen kalem var; bu hâliyle onaylanamaz. İşlemi iptal edip miktarı düzelterek yeniden açın.'
              : 'Onaylamadan stok değişmez.'}
          </p>
        </div>
      ) : null}

      {result ? <AppliedMovements result={result} preview={preview} /> : null}

      <div className="flex flex-wrap gap-3">
        <Link href="/operations/new" className={buttonVariants({ variant: 'secondary' })}>
          <Plus aria-hidden />
          Yeni stok işlemi
        </Link>
        <Link href="/stock" className={buttonVariants({ variant: 'ghost' })}>
          Stok listesine dön
        </Link>
      </div>
    </>
  );
}

function PreviewRow({
  line,
  pending,
  showCost,
  shortage,
}: {
  line: OperationPreviewLine;
  pending: boolean;
  showCost: boolean;
  shortage: Shortage | undefined;
}): JSX.Element {
  const insufficient = Boolean(shortage) || line.stock?.sufficient === false || line.targetStock?.sufficient === false;
  return (
    <TableRow className={insufficient ? 'bg-critical-soft' : undefined}>
      <TableCell className="text-text-muted tabular-nums">{line.lineNo}</TableCell>
      <TableCell>
        <span className="block text-body-md-medium">{line.productName}</span>
        <span className="block text-label-md font-normal text-text-muted tabular-nums">{line.sku}</span>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">
        <span className="block">
          {formatDecimal(line.quantity)} {line.unit ?? line.baseUnit}
        </span>
        {line.unit ? (
          <span className="block text-label-md font-normal text-text-muted">
            = {formatDecimal(line.baseQuantity)} {line.baseUnit}
          </span>
        ) : null}
      </TableCell>
      {showCost ? (
        <TableCell className="text-right whitespace-nowrap tabular-nums">
          {line.unitCost === null ? <span className="text-text-subtle">—</span> : `${formatDecimal(line.unitCost)} TL`}
        </TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap">
        {line.warehouse.name}
        {line.targetWarehouse ? ` → ${line.targetWarehouse.name}` : ''}
      </TableCell>
      {pending ? (
        <TableCell className="whitespace-nowrap tabular-nums">
          {line.stock ? (
            <StockChange label={line.targetWarehouse ? line.warehouse.name : null} effect={line.stock} unit={line.baseUnit} />
          ) : null}
          {line.targetStock && line.targetWarehouse ? (
            <StockChange label={line.targetWarehouse.name} effect={line.targetStock} unit={line.baseUnit} />
          ) : null}
        </TableCell>
      ) : null}
      {pending ? (
        <TableCell>
          {insufficient ? (
            <div className="flex flex-col items-start gap-1">
              <Badge variant="critical">Yetersiz stok</Badge>
              {shortage ? (
                <span className="text-label-md font-normal text-critical tabular-nums">
                  İstenen {formatDecimal(shortage.requested)}, mevcut {formatDecimal(shortage.available)} {line.baseUnit}
                </span>
              ) : null}
            </div>
          ) : (
            <Badge variant="applied">Yeterli</Badge>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function StockChange({ label, effect, unit }: { label: string | null; effect: StockEffect; unit: string }): JSX.Element {
  return (
    <span className={effect.sufficient ? 'block' : 'block text-critical'}>
      {label ? <span className="text-text-muted">{label}: </span> : null}
      {formatDecimal(effect.before)} → {formatDecimal(effect.after)} {unit}
    </span>
  );
}

/** Onayla yazılan hareketler: her depoda stoğun yeni miktarı (onay cevabından). */
function AppliedMovements({ result, preview }: { result: ConfirmOperationResult; preview: OperationPreview }): JSX.Element {
  const lineOf = new Map(preview.lines.map((line) => [line.lineNo, line]));
  const warehouseNames = new Map(
    preview.lines.flatMap((line) => [line.warehouse, ...(line.targetWarehouse ? [line.targetWarehouse] : [])]).map((ref) => [ref.id, ref.name]),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Yazılan hareketler</CardTitle>
        <CardDescription>Miktarlar ana birimde. Ürünün bütün hareketleri ürün sayfasında.</CardDescription>
      </CardHeader>
      <Table aria-label="Yazılan hareketler">
        <TableHeader>
          <TableRow className="h-auto border-0">
            <TableHead>Ürün</TableHead>
            <TableHead>Depo</TableHead>
            <TableHead>Hareket</TableHead>
            <TableHead className="text-right">Değişim</TableHead>
            <TableHead className="text-right">Yeni stok</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.movements.map((movement) => {
            const line = lineOf.get(movement.lineNo);
            return (
              <TableRow key={`${movement.lineNo}:${movement.warehouseId}`}>
                <TableCell>
                  <Link href={`/products/${movement.productId}`} className="text-body-md-medium text-primary-action underline">
                    {line?.productName ?? movement.productId}
                  </Link>
                </TableCell>
                <TableCell>{warehouseNames.get(movement.warehouseId) ?? '—'}</TableCell>
                <TableCell>{MOVEMENT_TYPE_LABELS[movement.type]}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDecimal(movement.quantityChange, { signed: true })} {line?.baseUnit}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDecimal(movement.quantityAfter)} {line?.baseUnit}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
