import { formatDecimal } from '@ambarci/shared';
import type { StockLevel } from '@ambarci/shared';
import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import type { JSX } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { useApi } from '@/api/api-provider';
import { useOrganizations } from '@/api/organization-provider';
import { useWarehouses } from '@/api/use-warehouses';
import { AppText } from '@/components/app-text';
import { OrganizationGate } from '@/components/organization-gate';
import { Card, Chip, StateMessage, StatusBadge, TextField } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { colors, radius, spacing, touchTarget } from '@/theme';

const PAGE_SIZE = 25;

/**
 * Stok listesi (docs/tasarim/2-mobil-stok-listesi.png): depo seçimi, ad/SKU/alternatif ad araması, kritik stok
 * rozeti. Miktarlar sunucudan gelen metinle gösterilir, uygulamada hesaplanmaz. Barkod okutma 7. haftada.
 */
export default function StockScreen(): JSX.Element {
  const { active } = useOrganizations();
  return (
    <>
      <Stack.Screen
        options={{
          title: active?.name ?? 'Stok',
          headerRight: () => (
            <Link href="/account" asChild>
              <Pressable accessibilityRole="button" hitSlop={8} style={styles.headerButton}>
                <AppText variant="labelLg" tone="primary">
                  Hesap
                </AppText>
              </Pressable>
            </Link>
          ),
        }}
      />
      <OrganizationGate>{() => <StockBrowser />}</OrganizationGate>
    </>
  );
}

function StockBrowser(): JSX.Element {
  const warehouses = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());

  if (warehouses.isPending) {
    return <StateMessage loading message="Depolar yükleniyor…" />;
  }
  if (warehouses.error) {
    return <StateMessage message={warehouses.error} onRetry={() => void warehouses.refetch()} />;
  }
  const selected = warehouses.permitted.find((warehouse) => warehouse.id === warehouseId) ?? warehouses.permitted[0];
  if (!selected) {
    return <StateMessage message="Stoğunu görebileceğin bir depo yok. Yöneticin web panelindeki Üyeler ekranından depo yetkisi verebilir." />;
  }

  const header = (
    <View style={styles.header}>
      <TextField
        value={search}
        onChangeText={setSearch}
        placeholder="Ürün, kod veya alternatif ad ara"
        accessibilityLabel="Ürün ara"
        autoCorrect={false}
        returnKeyType="search"
        maxLength={100}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {warehouses.permitted.map((warehouse) => (
          <Chip
            key={warehouse.id}
            label={warehouse.name}
            selected={warehouse.id === selected.id}
            onPress={() => setWarehouseId(warehouse.id)}
          />
        ))}
      </ScrollView>
    </View>
  );

  // Depo ya da arama değişince sorgu anahtarı değişir ve liste ilk sayfadan yüklenir. Liste yeniden kurulmaz:
  // kurulsaydı başlıktaki arama kutusu her aramada klavye odağını kaybederdi.
  return <StockList warehouseId={selected.id} warehouseName={selected.name} search={debouncedSearch} header={header} />;
}

function StockList({
  warehouseId,
  warehouseName,
  search,
  header,
}: {
  warehouseId: string;
  warehouseName: string;
  search: string;
  header: JSX.Element;
}): JSX.Element {
  const { $api } = useApi();
  const query = $api.useInfiniteQuery(
    'get',
    '/v1/warehouses/{warehouseId}/stock',
    { params: { path: { warehouseId }, query: { search: search || undefined, pageSize: PAGE_SIZE } } },
    {
      pageParamName: 'page',
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    },
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.productId}
      renderItem={({ item }) => <StockCard level={item} warehouseId={warehouseId} warehouseName={warehouseName} />}
      ListHeaderComponent={
        <>
          {header}
          <View style={styles.sectionRow}>
            <AppText variant="labelSm" tone="muted">
              ENVANTER KAYITLARI
            </AppText>
            {query.data ? (
              <View style={styles.countBadge}>
                <AppText variant="labelSm" tone="primary" tabular>
                  {total} ürün
                </AppText>
              </View>
            ) : null}
          </View>
        </>
      }
      ListEmptyComponent={
        query.isPending ? (
          <StateMessage loading message="Stok yükleniyor…" />
        ) : query.isError ? (
          <StateMessage message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <StateMessage message={search ? 'Aramaya uyan ürün yok.' : 'Bu şirkette henüz aktif ürün yok.'} />
        )
      }
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      }}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} />
      }
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyboardShouldPersistTaps="handled"
    />
  );
}

function StockCard({
  level,
  warehouseId,
  warehouseName,
}: {
  level: StockLevel;
  warehouseId: string;
  warehouseName: string;
}): JSX.Element {
  const router = useRouter();
  const critical = level.belowMinimum;
  const quantity = formatDecimal(level.quantity);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${level.name}, ${quantity} ${level.baseUnit}${critical ? ', kritik stok' : ''}`}
      accessibilityHint="Ürünün depolara göre stoğunu ve son hareketlerini açar"
      onPress={() => router.push({ pathname: '/products/[productId]', params: { productId: level.productId, warehouseId } })}
    >
      {({ pressed }) => (
        <Card style={pressed ? styles.cardPressed : null}>
          <View style={styles.cardTop}>
            <AppText variant="labelMd" tone="muted" tabular style={styles.flex}>
              {level.sku} • {warehouseName}
            </AppText>
            {critical ? (
              <StatusBadge status="critical" label="KRİTİK" />
            ) : level.minStock !== null ? (
              <StatusBadge status="applied" label="YETERLİ" />
            ) : null}
          </View>
          <AppText variant="bodyLgBold">{level.name}</AppText>
          <View style={styles.divider} />
          <View style={styles.cardBottom}>
            <View style={styles.flex}>
              <AppText>
                <AppText variant="headlineLgMobile" tone={critical ? 'critical' : 'text'} tabular>
                  {quantity}
                </AppText>
                <AppText variant="bodyLg" tone="muted">
                  {' '}
                  {level.baseUnit}
                </AppText>
              </AppText>
              {level.minStock !== null ? (
                <AppText variant="labelMd" tone={critical ? 'critical' : 'muted'} tabular>
                  (min {formatDecimal(level.minStock)} {level.baseUnit})
                </AppText>
              ) : null}
            </View>
            <View style={styles.arrow}>
              <AppText variant="titleMd" tone="primary">
                →
              </AppText>
            </View>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  list: {
    padding: spacing.md,
    flexGrow: 1,
  },
  header: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  chips: {
    gap: spacing.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  countBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  separator: {
    height: spacing.md,
  },
  footer: {
    marginVertical: spacing.md,
  },
  cardPressed: {
    backgroundColor: colors.primarySoft,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  arrow: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
  },
});
