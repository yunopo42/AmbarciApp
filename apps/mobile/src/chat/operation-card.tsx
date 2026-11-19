import { cardActionFailure, confirmKeyFor, describeApiError, operationCardView, randomUuid } from '@ambarci/api-client';
import type { CardConfirmKey, CardLine, CardTone } from '@ambarci/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useApi } from '@/api/api-provider';
import { AppText } from '@/components/app-text';
import type { TextTone } from '@/components/app-text';
import { Button, Card } from '@/components/ui';
import { colors, radius, spacing, tabularNums } from '@/theme';

// Sohbetteki işlem kartı (#76; docs/tasarim.md "İşlem kartı (sohbet)", docs/tasarim/1-mobil-sohbet.png). Asistan
// öneriyi hazırlar; kart işlemin güncel hâlini önizleme ucundan okur ve "Onayla" doğrudan onay ucuna gider: onay
// asistandan geçmez (mimari değişmez 2). Ne gösterileceği ve hangi düğmenin açık olduğu web kartıyla ortak
// (packages/api-client/src/operation-card.ts).

const PREVIEW_PATH = '/v1/operations/{operationId}/preview';

/** Rozetin renkleri (docs/tasarim.md durum renkleri). Mobilde büyük harf metnin kendisinde yazılır. */
const BADGE: Record<CardTone, { background: string; border: string; text: TextTone; dot: string }> = {
  pending: { background: colors.pendingSoft, border: colors.pendingBorder, text: 'pending', dot: colors.pendingFill },
  applied: { background: colors.appliedSoft, border: colors.appliedBorder, text: 'applied', dot: colors.appliedFill },
  muted: { background: colors.divider, border: colors.border, text: 'muted', dot: colors.borderStrong },
};

export function OperationCard({
  operationId,
  version,
  onEdit,
}: {
  operationId: string;
  /** Akışta ya da geçmişte bildirilen sürüm; öneri sohbette düzenlenince artar ve kart yeniden okunur. */
  version?: number;
  onEdit: () => void;
}): JSX.Element {
  const { $api } = useApi();
  const queryClient = useQueryClient();
  const init = useMemo(() => ({ params: { path: { operationId } } }), [operationId]);
  const query = $api.useQuery('get', PREVIEW_PATH, init);
  const confirm = $api.useMutation('post', '/v1/operations/{operationId}/confirm');
  const cancel = $api.useMutation('post', '/v1/operations/{operationId}/cancel');
  // Onay anahtarı: bu sürümün ilk onay denemesinde üretilir, aynı sürümün sonraki denemeleri (çift dokunma, ağ
  // hatasından sonra tekrar) aynı anahtarı kullanır; sürüm değişince yenisi. Ref: aynı anda iki dokunuşta da aynı anahtar.
  const confirmKey = useRef<CardConfirmKey | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const busy = confirm.isPending || cancel.isPending;
  const previewKey = useMemo(() => $api.queryOptions('get', PREVIEW_PATH, init).queryKey, [$api, init]);

  // Öneri sohbette düzenlendi (akışta yeni sürüm geldi): kart güncel hâli okur.
  const shownVersion = query.data?.version;
  useEffect(() => {
    if (version !== undefined && shownVersion !== undefined && version > shownVersion) {
      void queryClient.invalidateQueries({ queryKey: previewKey });
    }
  }, [version, shownVersion, previewKey, queryClient]);

  // Son onay anı geçince kart kendiliğinden "Süresi doldu" olsun diye saati yarım dakikada bir yeniler.
  const expiresAt = query.data?.expiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) {
      return undefined;
    }
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: previewKey }),
      // Stok listesi, ürün detayı ve hareketler bir sonraki açılışta sunucudan yeniden okunur.
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/warehouses/{warehouseId}/stock'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/products/{productId}/stock'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/products/{productId}/movements'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/operations'] }),
    ]);
  }

  async function act(run: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await run();
      await refresh();
    } catch (reason) {
      const failure = cardActionFailure(describeApiError(reason));
      setActionError(failure.message);
      if (failure.refresh) {
        await refresh();
      }
    }
  }

  if (query.isPending) {
    return (
      <Card style={styles.card}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <AppText tone="muted">Öneri yükleniyor…</AppText>
        </View>
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card style={styles.card}>
        <AppText tone="critical">{describeApiError(query.error).message}</AppText>
        <Button label="Tekrar dene" variant="secondary" onPress={() => void query.refetch()} />
      </Card>
    );
  }

  const preview = query.data;
  const view = operationCardView(preview, now);
  const badge = BADGE[view.status.tone];

  return (
    <Card style={styles.card} accessibilityLabel={`${view.title}, ${view.status.label}`}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: badge.dot }]} />
        <AppText variant="titleMd" style={styles.title}>
          {view.title}
        </AppText>
        <View style={[styles.badge, { backgroundColor: badge.background, borderColor: badge.border }]}>
          <AppText variant="labelSm" tone={badge.text}>
            {view.status.label.toLocaleUpperCase('tr-TR')}
          </AppText>
        </View>
      </View>

      <View style={styles.details}>
        {view.lines.map((line, index) => (
          <LineDetails key={line.lineNo} line={line} first={index === 0} />
        ))}
        {view.party ? <Field label="Cari" value={view.party} /> : null}
        {view.note ? <Field label="Not" value={view.note} /> : null}
      </View>

      {view.canConfirm ? (
        <Button
          label={confirm.isPending ? 'Onaylanıyor…' : 'Onayla'}
          disabled={busy}
          accessibilityHint="Stoğu bu öneriye göre değiştirir"
          onPress={() => {
            confirmKey.current = confirmKeyFor(confirmKey.current, preview.version, randomUuid);
            const key = confirmKey.current.key;
            void act(() =>
              confirm.mutateAsync({
                params: { path: { operationId }, header: { 'Idempotency-Key': key } },
                body: { version: preview.version },
              }),
            );
          }}
        />
      ) : null}
      {view.canEdit || view.canCancel ? (
        <View style={styles.secondaryRow}>
          {view.canEdit ? (
            <View style={styles.flex}>
              <Button label="Düzenle" variant="secondary" disabled={busy} accessibilityHint="Değişikliği sohbete yazarsın" onPress={onEdit} />
            </View>
          ) : null}
          {view.canCancel ? (
            <View style={styles.flex}>
              <Button
                label={cancel.isPending ? 'İptal ediliyor…' : 'İptal'}
                variant="secondary"
                disabled={busy}
                accessibilityHint="Öneriyi iptal eder; stok değişmez"
                onPress={() => void act(() => cancel.mutateAsync({ params: { path: { operationId } } }))}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {actionError ? (
        <AppText tone="critical" accessibilityRole="alert">
          {actionError}
        </AppText>
      ) : null}
      {view.footnote ? (
        <AppText variant="labelMd" tone="muted" style={styles.footnote}>
          {view.footnote}
        </AppText>
      ) : null}
    </Card>
  );
}

function LineDetails({ line, first }: { line: CardLine; first: boolean }): JSX.Element {
  return (
    <View style={[styles.line, first ? null : styles.lineSeparated]}>
      <Field label="Ürün" value={line.product} />
      <Field label={line.quantityLabel} value={line.quantity} emphasized />
      <Field label="Depo" value={line.warehouse} />
      {line.shortage ? (
        <AppText tone="critical" style={styles.shortage}>
          {line.shortage}
        </AppText>
      ) : null}
      {line.stockChange ? <Field label="Stok değişimi" value={`${line.stockChange.before} → ${line.stockChange.after}`} tabular /> : null}
      {line.targetStockChange ? (
        <Field label="Hedef depo" value={`${line.targetStockChange.before} → ${line.targetStockChange.after}`} tabular />
      ) : null}
    </View>
  );
}

function Field({ label, value, emphasized = false, tabular = false }: { label: string; value: string; emphasized?: boolean; tabular?: boolean }): JSX.Element {
  return (
    <View style={styles.field}>
      <AppText tone="muted" style={styles.fieldLabel}>
        {`${label}:`}
      </AppText>
      <AppText
        variant={emphasized ? 'bodyLgBold' : 'bodyLg'}
        tone={emphasized ? 'primary' : 'text'}
        style={[styles.fieldValue, tabular ? tabularNums : null]}
        selectable
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
  },
  title: {
    flex: 1,
  },
  badge: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: 10,
  },
  details: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  line: {
    gap: spacing.sm,
  },
  lineSeparated: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  fieldLabel: {
    flexShrink: 0,
  },
  fieldValue: {
    flex: 1,
    textAlign: 'right',
  },
  shortage: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.criticalSoft,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  footnote: {
    textAlign: 'center',
  },
});
