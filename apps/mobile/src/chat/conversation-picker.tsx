import type { JSX } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '@/api/api-provider';
import { AppText } from '@/components/app-text';
import { Button, StateMessage } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { colors, spacing, touchTarget } from '@/theme';

const PAGE_SIZE = 20;
const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Sohbet geçmişi: kullanıcının aktif şirketteki sohbetleri, en son konuşulan önce, ve "Yeni sohbet". Ekrandan
 * açılan bir pencere; seçilen sohbet aynı ekranda açılır.
 */
export function ConversationPicker({
  visible,
  currentId,
  onSelect,
  onNew,
  onClose,
}: {
  visible: boolean;
  currentId: string | null;
  onSelect: (conversationId: string) => void;
  onNew: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <AppText variant="headlineSm" style={styles.flex}>
            Sohbetler
          </AppText>
          <Pressable accessibilityRole="button" hitSlop={8} style={styles.close} onPress={onClose}>
            <AppText variant="labelLg" tone="primary">
              Kapat
            </AppText>
          </Pressable>
        </View>
        <View style={styles.newButton}>
          <Button label="Yeni sohbet" onPress={onNew} />
        </View>
        {/* Liste pencere her açıldığında kurulur; böylece son sohbetler güncel gelir. */}
        {visible ? <ConversationList currentId={currentId} onSelect={onSelect} /> : null}
      </SafeAreaView>
    </Modal>
  );
}

function ConversationList({
  currentId,
  onSelect,
}: {
  currentId: string | null;
  onSelect: (conversationId: string) => void;
}): JSX.Element {
  const { $api } = useApi();
  const query = $api.useInfiniteQuery(
    'get',
    '/v1/conversations',
    { params: { query: { pageSize: PAGE_SIZE } } },
    {
      pageParamName: 'page',
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    },
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => {
        const selected = item.id === currentId;
        const title = item.title ?? 'Başlıksız sohbet';
        const time = dateTimeFormat.format(new Date(item.lastMessageAt));
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${title}, ${time}`}
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [styles.item, selected || pressed ? styles.itemSelected : null]}
          >
            <AppText variant="bodyLgBold" tone={selected ? 'primary' : 'text'} numberOfLines={1}>
              {title}
            </AppText>
            <AppText tone="muted" tabular>
              {time}
            </AppText>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        query.isPending ? (
          <StateMessage loading message="Sohbetler yükleniyor…" />
        ) : query.isError ? (
          <StateMessage message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <StateMessage message="Henüz sohbet yok. İlk sorunu sorunca burada görünür." />
        )
      }
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : null}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      }}
      onEndReachedThreshold={0.5}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  close: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  newButton: {
    padding: spacing.md,
  },
  list: {
    flexGrow: 1,
    paddingBottom: spacing.md,
  },
  // Liste satırı (docs/tasarim.md): en az 56, dikey 14 iç boşluk, divider ayırıcı.
  item: {
    minHeight: 56,
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
  },
  itemSelected: {
    backgroundColor: colors.primarySoft,
  },
  separator: {
    height: 1,
    backgroundColor: colors.divider,
  },
  footer: {
    marginVertical: spacing.md,
  },
  flex: {
    flex: 1,
  },
});
