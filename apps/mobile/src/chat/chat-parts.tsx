import { splitBoldText, turnStatusLabel } from '@ambarci/api-client';
import type { ChatRow, SavedChatMessage } from '@ambarci/api-client';
import type { JSX } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui';
import { colors, radius, shadows, spacing } from '@/theme';

// Sohbet ekranının parçaları (docs/tasarim/1-mobil-sohbet.png): kullanıcının balonu primary zeminli, asistanın
// cevabı kart zeminli; ikisi de radius-lg ve body-lg (docs/tasarim.md).

/** Kullanıcının mesajı: sağda, primary zemin, on-primary metin. */
export function UserBubble({ text }: { text: string }): JSX.Element {
  return (
    <View style={[styles.bubble, styles.userBubble]}>
      <AppText variant="bodyLg" tone="onPrimary" selectable>
        {text}
      </AppText>
    </View>
  );
}

/** Asistanın cevabı: solda, "Ambarcı Asistan" etiketi ve "Yapay Zeka" rozetiyle, kart zemininde. */
export function AssistantBubble({ text }: { text: string }): JSX.Element {
  return (
    <View style={styles.assistant}>
      <View style={styles.assistantHeader}>
        <AppText variant="labelLg" tone="primary">
          Ambarcı Asistan
        </AppText>
        <View style={styles.aiBadge}>
          <AppText variant="labelSm" tone="primary">
            YAPAY ZEKA
          </AppText>
        </View>
      </View>
      <View style={[styles.bubble, styles.assistantBubble]}>
        {/* Kalın parçalar iç içe metinle: satır kaydırma ve seçme tek metin gibi çalışır. */}
        <AppText variant="bodyLg" selectable>
          {splitBoldText(text).map((segment, index) =>
            segment.bold ? (
              <AppText key={index} variant="bodyLgBold">
                {segment.text}
              </AppText>
            ) : (
              segment.text
            ),
          )}
        </AppText>
      </View>
    </View>
  );
}

/** Cevap beklenirken durum satırı: "Ürün aranıyor…", "Cevap hazırlanıyor…". */
export function StatusLine({ label }: { label: string }): JSX.Element {
  return (
    <View style={styles.status} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={colors.primary} />
      <AppText tone="muted" style={styles.flex}>
        {label}
      </AppText>
    </View>
  );
}

/** Cevap alınamadı: Türkçe hata mesajı ve "Tekrar gönder" (aynı istemci kimliğiyle). */
export function FailureNote({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled: boolean }): JSX.Element {
  return (
    <View style={styles.failure} accessibilityRole="alert">
      <AppText tone="critical">{message}</AppText>
      <Button label="Tekrar gönder" variant="secondary" disabled={disabled} onPress={onRetry} />
    </View>
  );
}

/** Sohbetin bir satırı: kayıtlı mesaj ya da bu ekrandan gönderilen mesaj ve akan cevabı. */
export function ChatRowView({
  row,
  busy,
  onRetry,
  onReload,
}: {
  row: ChatRow;
  busy: boolean;
  onRetry: (clientMessageId: string, text: string) => void;
  onReload: () => void;
}): JSX.Element {
  if (row.kind === 'message') {
    return <SavedRow message={row.message} note={row.note} busy={busy} onRetry={onRetry} onReload={onReload} />;
  }
  const { turn } = row;
  const status = turnStatusLabel(turn);
  return (
    <View style={styles.row}>
      <UserBubble text={turn.text} />
      {turn.answer ? <AssistantBubble text={turn.answer} /> : null}
      {status ? <StatusLine label={status} /> : null}
      {turn.status === 'failed' && turn.error ? (
        <FailureNote message={turn.error.message} disabled={busy} onRetry={() => onRetry(turn.clientMessageId, turn.text)} />
      ) : null}
    </View>
  );
}

function SavedRow({
  message,
  note,
  busy,
  onRetry,
  onReload,
}: {
  message: SavedChatMessage;
  note: 'failed' | 'in_progress' | null;
  busy: boolean;
  onRetry: (clientMessageId: string, text: string) => void;
  onReload: () => void;
}): JSX.Element {
  if (message.role === 'assistant') {
    return (
      <View style={styles.row}>
        <AssistantBubble text={message.text} />
      </View>
    );
  }
  const clientMessageId = message.clientMessageId;
  return (
    <View style={styles.row}>
      <UserBubble text={message.text} />
      {note === 'failed' && clientMessageId ? (
        <FailureNote message="Bu mesaja cevap alınamadı." disabled={busy} onRetry={() => onRetry(clientMessageId, message.text)} />
      ) : null}
      {note === 'in_progress' ? (
        <View style={styles.pending}>
          <StatusLine label="Cevap hâlâ hazırlanıyor." />
          <Button label="Yenile" variant="secondary" onPress={onReload} />
        </View>
      ) : null}
    </View>
  );
}

/** Yeni sohbet: ne sorulabileceği ve asistanın stoğu değiştirmediği. */
export function EmptyChat(): JSX.Element {
  return (
    <View style={styles.empty}>
      <AppText variant="titleMd">Stoğu sor, asistan cevaplasın.</AppText>
      <AppText tone="muted" style={styles.center}>
        Yazarak ya da &quot;Konuş&quot;a basarak sorabilirsin. Örnek: &quot;Merkez depoda NYM 3x2,5 kablo kaç metre var?&quot;
      </AppText>
      <AppText variant="labelMd" tone="muted" style={styles.center}>
        Asistan şimdilik yalnızca bilgi verir; stoğu değiştirmez.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
  },
  bubble: {
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.primary,
  },
  assistant: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    gap: spacing.xs,
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  aiBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  assistantBubble: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.level1,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  failure: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.criticalBorder,
    backgroundColor: colors.criticalSoft,
  },
  pending: {
    gap: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  center: {
    textAlign: 'center',
  },
  flex: {
    flex: 1,
  },
});
