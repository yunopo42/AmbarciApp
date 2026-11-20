'use client';

import { cardActionFailure, operationCardView } from '@ambarci/api-client';
import type { CardLine, CardTone } from '@ambarci/api-client';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOperationActions } from '@/components/use-operation-actions';
import { cn } from '@/lib/utils';

// Sohbet panelindeki işlem kartı (#77): mobil kartla (#76) aynı alanlar, düğmeler ve durumlar; ne gösterileceği ortak
// pakette (packages/api-client/src/operation-card.ts). Önizleme, onay ve iptal web'deki özet sayfasıyla ortak
// (use-operation-actions.ts). Onay asistandan geçmez, onay ucuna doğrudan gider (mimari değişmez 2).

const DOT: Record<CardTone, string> = {
  pending: 'bg-pending-fill',
  applied: 'bg-applied-fill',
  muted: 'bg-border-strong',
};

export function OperationCard({
  operationId,
  version,
  onEdit,
}: {
  operationId: string;
  /** Akışta bildirilen sürüm; öneri sohbette düzenlenince artar ve kart yeniden okunur. */
  version?: number;
  onEdit: () => void;
}): JSX.Element {
  const actions = useOperationActions(operationId);
  const [now, setNow] = useState(() => new Date());
  const shownVersion = actions.preview?.version;
  const { refresh } = actions;

  // Öneri sohbette düzenlendi (akışta yeni sürüm geldi): kart güncel hâli okur.
  useEffect(() => {
    if (version !== undefined && shownVersion !== undefined && version > shownVersion) {
      void refresh();
    }
  }, [version, shownVersion, refresh]);

  // Son onay anı geçince kart kendiliğinden "Süresi doldu" olsun diye saati yarım dakikada bir yeniler.
  const expiresAt = actions.preview?.expiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) {
      return undefined;
    }
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (actions.loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-text-muted shadow-1">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-primary" />
        Öneri yükleniyor…
      </div>
    );
  }
  if (!actions.preview) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 shadow-1">
        <Alert>{actions.loadError ?? 'Öneri okunamadı.'}</Alert>
        <Button variant="secondary" size="sm" onClick={() => void actions.refresh()}>
          Tekrar dene
        </Button>
      </div>
    );
  }

  const preview = actions.preview;
  const view = operationCardView(preview, now);
  const message = actions.failure ? cardActionFailure(actions.failure).message : null;

  const card = (
    <section aria-label={`${view.title}, ${view.status.label}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-1">
      <header className="flex items-center gap-2 border-b border-divider pb-2">
        <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', DOT[view.status.tone])} />
        <h3 className="flex-1 text-title-md text-text">{view.title}</h3>
        <Badge variant={view.status.tone}>{view.status.label}</Badge>
      </header>

      <dl className="flex flex-col gap-2 rounded-md border border-border bg-canvas p-3 text-body-md">
        {view.lines.map((line, index) => (
          <LineDetails key={line.lineNo} line={line} separated={index > 0} />
        ))}
        {view.party ? <Field label="Cari" value={view.party} /> : null}
        {view.note ? <Field label="Not" value={view.note} /> : null}
      </dl>

      {view.canConfirm ? (
        <Button className="w-full" disabled={actions.busy} onClick={() => void actions.confirm(preview.version)}>
          {actions.confirming ? 'Onaylanıyor…' : 'Onayla'}
        </Button>
      ) : null}
      {view.canEdit || view.canCancel ? (
        <div className="grid grid-cols-2 gap-2">
          {view.canEdit ? (
            <Button variant="secondary" disabled={actions.busy} onClick={onEdit}>
              Düzenle
            </Button>
          ) : null}
          {view.canCancel ? (
            <Button variant="secondary" disabled={actions.busy} onClick={() => void actions.cancel()}>
              {actions.cancelling ? 'İptal ediliyor…' : 'İptal'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {view.canReverse ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={actions.busy}
          title="Onay bekleyen bir ters kayıt açar; stok, ters kaydı onaylayınca eski hâline döner"
          onClick={() => void actions.reverse()}
        >
          {actions.reversing ? 'Ters kayıt açılıyor…' : 'Geri al'}
        </Button>
      ) : null}

      {message ? <Alert>{message}</Alert> : null}
      {view.footnote ? <p className="text-center text-label-md font-normal text-text-muted">{view.footnote}</p> : null}
      <Link href={`/operations/${operationId}`} className="self-center text-label-md text-primary-action underline">
        İşlemin özetini aç
      </Link>
    </section>
  );

  // İşlemin ters kaydı kendi kartıyla, hemen altında (#78): onay ve iptal oradan yapılır; sohbetle düzenlenmez.
  return view.reversalId ? (
    <>
      {card}
      <OperationCard operationId={view.reversalId} onEdit={onEdit} />
    </>
  ) : (
    card
  );
}

function LineDetails({ line, separated }: { line: CardLine; separated: boolean }): JSX.Element {
  return (
    <div className={cn('flex flex-col gap-2', separated && 'border-t border-border pt-2')}>
      <Field label="Ürün" value={line.product} />
      <Field label={line.quantityLabel} value={line.quantity} emphasized />
      <Field label="Depo" value={line.warehouse} />
      {line.shortage ? <p className="rounded-sm bg-critical-soft p-2 text-critical">{line.shortage}</p> : null}
      {line.stockChange ? <Field label="Stok değişimi" value={`${line.stockChange.before} → ${line.stockChange.after}`} tabular /> : null}
      {line.targetStockChange ? (
        <Field label="Hedef depo" value={`${line.targetStockChange.before} → ${line.targetStockChange.after}`} tabular />
      ) : null}
    </div>
  );
}

function Field({ label, value, emphasized = false, tabular = false }: { label: string; value: string; emphasized?: boolean; tabular?: boolean }): JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-text-muted">{label}:</dt>
      <dd className={cn('text-right', emphasized ? 'text-body-md-medium text-primary' : 'text-text', tabular && 'tabular-nums')}>{value}</dd>
    </div>
  );
}
