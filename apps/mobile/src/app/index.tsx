import { MESSAGE_TEXT_MAX_LENGTH } from '@ambarci/shared';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { FlatList, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOrganizations } from '@/api/organization-provider';
import { ChatRowView, EmptyChat } from '@/chat/chat-parts';
import { Composer } from '@/chat/composer';
import { ConversationPicker } from '@/chat/conversation-picker';
import { useChat } from '@/chat/use-chat';
import type { ChatRow } from '@/chat/use-chat';
import { useSpeechInput } from '@/chat/use-speech-input';
import { OrganizationGate } from '@/components/organization-gate';
import { HeaderTextButton, StateMessage } from '@/components/ui';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import { randomUuid } from '@/lib/uuid';
import { spacing } from '@/theme';

/**
 * Açık sohbet. `key` yalnızca kullanıcı başka sohbet seçince ya da yeni sohbete geçince değişir ve ekranı baştan
 * kurar; yeni sohbet ilk mesajla oluşunca kimlik eklenir ama `key` aynı kalır, akan cevap kesilmez.
 */
interface ChatSession {
  key: string;
  conversationId: string | null;
}

/**
 * Ana ekran: asistanla sohbet (docs/tasarim/1-mobil-sohbet.png). Soru yazılarak ya da "Konuş"la sorulur; cevap
 * parça parça görünür, araç çalışırken durum satırı çıkar. Başlıkta sohbet geçmişi ve stok listesi.
 */
export default function ChatScreen(): JSX.Element {
  const router = useRouter();
  const { active } = useOrganizations();
  const [session, setSession] = useState<ChatSession>(() => ({ key: randomUuid(), conversationId: null }));
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleCreated = useCallback((conversationId: string) => {
    setSession((current) => ({ ...current, conversationId }));
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: active?.name ?? 'Asistan',
          headerLeft: () => <HeaderTextButton label="Sohbetler" onPress={() => setPickerOpen(true)} />,
          headerRight: () => <HeaderTextButton label="Stok" onPress={() => router.push('/stock')} />,
        }}
      />
      <OrganizationGate>
        {() => (
          <>
            <ChatView key={session.key} conversationId={session.conversationId} onConversationCreated={handleCreated} />
            <ConversationPicker
              visible={pickerOpen}
              currentId={session.conversationId}
              onSelect={(conversationId) => {
                setSession((current) => (current.conversationId === conversationId ? current : { key: conversationId, conversationId }));
                setPickerOpen(false);
              }}
              onNew={() => {
                setSession({ key: randomUuid(), conversationId: null });
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          </>
        )}
      </OrganizationGate>
    </>
  );
}

function rowKey(row: ChatRow): string {
  return row.kind === 'message' ? row.message.id : `turn-${row.turn.clientMessageId}`;
}

function ChatView({
  conversationId,
  onConversationCreated,
}: {
  conversationId: string | null;
  onConversationCreated: (conversationId: string) => void;
}): JSX.Element {
  const chat = useChat(conversationId, onConversationCreated);
  const [draft, setDraft] = useState('');
  const speech = useSpeechInput((transcript) => setDraft(transcript.slice(0, MESSAGE_TEXT_MAX_LENGTH)));
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();

  // Klavye açılınca mesaj kutusu klavyenin üstüne çıkar. KeyboardAvoidingView kendi konumunu üst öğesine göre bilir;
  // ekran başlığının yüksekliği kadar fark, ekranın pencere içindeki konumu ölçülerek verilir.
  const containerRef = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  // Liste ters çevrilmiş (inverted): en yeni mesaj altta durur, yeni parça gelince liste kendiliğinden altta kalır.
  const data = useMemo(() => [...chat.rows].reverse(), [chat.rows]);

  function handleSend(): void {
    if (chat.busy || !draft.trim()) {
      return;
    }
    chat.send(draft);
    setDraft('');
  }

  let content: JSX.Element;
  if (chat.isLoading) {
    content = <StateMessage loading message="Sohbet yükleniyor…" />;
  } else if (chat.loadError && chat.rows.length === 0) {
    content = <StateMessage message={chat.loadError} onRetry={chat.reload} />;
  } else if (chat.rows.length === 0) {
    content = <EmptyChat />;
  } else {
    content = (
      <FlatList
        inverted
        data={data}
        keyExtractor={rowKey}
        renderItem={({ item }) => <ChatRowView row={item} busy={chat.busy} onRetry={chat.retry} onReload={chat.reload} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <View
      ref={containerRef}
      style={styles.flex}
      onLayout={() => containerRef.current?.measureInWindow((_x, y) => setKeyboardOffset(y))}
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
        <View style={styles.flex}>{content}</View>
        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={handleSend}
          busy={chat.busy}
          speech={speech}
          bottomInset={keyboardVisible ? 0 : insets.bottom}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    padding: spacing.md,
  },
  separator: {
    height: spacing.md,
  },
});
