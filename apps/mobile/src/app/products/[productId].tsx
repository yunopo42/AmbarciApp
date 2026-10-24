import { formatDecimal, MOVEMENT_TYPE_LABELS, WAREHOUSE_TYPE_LABELS } from '@ambarci/shared';
import type { ProductMovement } from '@ambarci/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { JSX, ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useApi } from '@/api/api-provider';
import { AppText } from '@/components/app-text';
import { OrganizationGate } from '@/components/organization-gate';
import { Card, StateMessage, StatusBadge } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { colors, spacing } from '@/theme';

const RECENT_MOVEMENTS = 10;
const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/** Ürün detayı: depolara göre stok ve toplam, birimler, alternatif adlar ve son hareketler. */
export default function ProductScreen(): JSX.Element {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  return <OrganizationGate>{() => <ProductDetail productId={productId} />}</OrganizationGate>;
}

function ProductDetail({ productId }: { productId: string }): JSX.Element {
  const { $api } = useApi();
  const path = { params: { path: { productId } } };
  const product = $api.useQuery('get', '/v1/products/{productId}', path);
  // Çalışan yalnızca yetkili olduğu depoları ve onların hareketlerini görür (API'de süzülür).
  const stock = $api.useQuery('get', '/v1/products/{productId}/stock', path);
  const movements = $api.useQuery('get', '/v1/products/{productId}/movements', {
    params: { path: { productId }, query: { pageSize: RECENT_MOVEMENTS } },
  });

  const refreshing = product.isRefetching || stock.isRefetching || movements.isRefetching;
  const refresh = (): void => {
    void product.refetch();
    void stock.refetch();
    void movements.refetch();
  };

  if (product.isPending) {
    return <StateMessage loading message="Ürün yükleniyor…" />;
  }
  if (product.isError) {
    return <StateMessage message={errorMessage(product.error)} onRetry={refresh} />;
  }
  const item = product.data;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Stack.Screen options={{ title: item.name }} />

      <Card style={styles.gap}>
        <AppText variant="labelMd" tone="muted" tabular>
          {item.sku}
          {item.barcode ? ` • ${item.barcode}` : ''}
        </AppText>
        <AppText variant="headlineSm">{item.name}</AppText>
        {stock.data ? (
          <AppText>
            <AppText variant="headlineLgMobile" tabular>
              {formatDecimal(stock.data.total)}
            </AppText>
            <AppText variant="bodyLg" tone="muted">
              {' '}
              {item.baseUnit} toplam
            </AppText>
          </AppText>
        ) : null}
        {item.minStock !== null ? (
          <AppText tone="muted" tabular>
            Kritik stok: depo başına {formatDecimal(item.minStock)} {item.baseUnit}
          </AppText>
        ) : null}
        {!item.isActive ? <AppText tone="critical">Bu ürün pasif; yeni işlemlerde kullanılamaz.</AppText> : null}
      </Card>

      <Section title="DEPOLARA GÖRE STOK">
        {stock.isPending ? (
          <StateMessage loading message="Stok yükleniyor…" />
        ) : stock.isError ? (
          <StateMessage message={errorMessage(stock.error)} onRetry={() => void stock.refetch()} />
        ) : stock.data.warehouses.length === 0 ? (
          <AppText tone="muted">Stoğunu görebileceğin bir depo yok.</AppText>
        ) : (
          stock.data.warehouses.map((row, index) => (
            <Row key={row.warehouse.id} first={index === 0}>
              <View style={styles.flex}>
                <AppText variant="bodyLgBold">{row.warehouse.name}</AppText>
                <AppText tone="muted">{WAREHOUSE_TYPE_LABELS[row.warehouse.type]}</AppText>
              </View>
              <View style={styles.right}>
                <AppText variant="bodyLgBold" tone={row.belowMinimum ? 'critical' : 'text'} tabular>
                  {formatDecimal(row.quantity)} {item.baseUnit}
                </AppText>
                {row.belowMinimum ? <StatusBadge status="critical" label="KRİTİK" /> : null}
              </View>
            </Row>
          ))
        )}
      </Section>

      <Section title="BİRİMLER">
        <Row first>
          <AppText variant="bodyLg" style={styles.flex}>
            {item.baseUnit}
          </AppText>
          <AppText tone="muted">ana birim</AppText>
        </Row>
        {item.units.map((unit) => (
          <Row key={unit.unit}>
            <AppText variant="bodyLg" tabular style={styles.flex}>
              1 {unit.unit} = {formatDecimal(unit.factor)} {item.baseUnit}
            </AppText>
            {unit.barcode ? (
              <AppText tone="muted" tabular>
                {unit.barcode}
              </AppText>
            ) : null}
          </Row>
        ))}
      </Section>

      {item.aliases.length > 0 ? (
        <Section title="ALTERNATİF ADLAR">
          <AppText variant="bodyLg">{item.aliases.join(', ')}</AppText>
        </Section>
      ) : null}

      <Section title="SON HAREKETLER">
        {movements.isPending ? (
          <StateMessage loading message="Hareketler yükleniyor…" />
        ) : movements.isError ? (
          <StateMessage message={errorMessage(movements.error)} onRetry={() => void movements.refetch()} />
        ) : movements.data.items.length === 0 ? (
          <AppText tone="muted">Bu ürünün henüz hareketi yok.</AppText>
        ) : (
          movements.data.items.map((movement, index) => (
            <MovementRow key={movement.id} movement={movement} baseUnit={item.baseUnit} first={index === 0} />
          ))
        )}
      </Section>
    </ScrollView>
  );
}

function MovementRow({ movement, baseUnit, first }: { movement: ProductMovement; baseUnit: string; first: boolean }): JSX.Element {
  const outgoing = movement.quantityChange.startsWith('-');
  return (
    <Row first={first}>
      <View style={styles.flex}>
        <AppText variant="bodyMdMedium">
          {MOVEMENT_TYPE_LABELS[movement.type]} • {movement.warehouse.name}
        </AppText>
        <AppText variant="labelMd" tone="muted" tabular>
          {dateTimeFormat.format(new Date(movement.createdAt))}
        </AppText>
      </View>
      <View style={styles.right}>
        {/* Yön işaretle de yazılır (+ / −); renk tek başına anlam taşımaz. */}
        <AppText variant="bodyLgBold" tone={outgoing ? 'critical' : 'applied'} tabular>
          {formatDecimal(movement.quantityChange, { signed: true })} {baseUnit}
        </AppText>
        <AppText variant="labelMd" tone="muted" tabular>
          sonra {formatDecimal(movement.quantityAfter)}
        </AppText>
      </View>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <View style={styles.section}>
      <AppText variant="labelSm" tone="muted">
        {title}
      </AppText>
      <Card>{children}</Card>
    </View>
  );
}

/** Liste satırı: en az 56 yükseklik, dikey 14 iç boşluk, divider ayırıcı (docs/tasarim.md). */
function Row({ first = false, children }: { first?: boolean; children: ReactNode }): JSX.Element {
  return <View style={[styles.row, first ? null : styles.rowDivider]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
    gap: spacing.md,
  },
  gap: {
    gap: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 56,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  right: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
});
