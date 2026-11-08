import { MESSAGE_TEXT_MAX_LENGTH } from '@ambarci/shared';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';

import type { SpeechInput } from './use-speech-input';

/**
 * Mesaj kutusu ve tek eylem düğmesi (tasarımdaki gibi sağda tek ana düğme): kutu boşken "Konuş", dinlerken "Dur",
 * kutuda metin varken "Gönder". Sesle tanınan metin kutuya yazılır; kullanıcı düzeltip "Gönder"e basar, mesaj
 * kendiliğinden gitmez.
 */
export function Composer({
  value,
  onChangeText,
  onSend,
  busy,
  speech,
  bottomInset,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Önceki mesajın cevabı sürüyor: gönderilemez, ama yazılabilir ve konuşulabilir. */
  busy: boolean;
  speech: SpeechInput;
  /** Klavye kapalıyken telefonun alt çubuğunun yüksekliği. */
  bottomInset: number;
}): JSX.Element {
  const hasText = value.trim().length > 0;

  // Ses uyarısı ("Ses algılanmadı" gibi) yalnızca son ses denemesiyle ilgilidir. Kullanıcı yazmaya başlayınca ya da
  // mesajı gönderince kaldırılır; 4. hafta kapı denemesinde sonraki mesajlar gönderildiği hâlde ekranda kalıyordu.
  const changeText = (text: string): void => {
    if (speech.error) {
      speech.clearError();
    }
    onChangeText(text);
  };
  const send = (): void => {
    speech.clearError();
    onSend();
  };

  let action: JSX.Element;
  if (speech.listening) {
    action = <Button label="Dur" accessibilityHint="Dinlemeyi bitirir" onPress={speech.stop} />;
  } else if (hasText) {
    action = (
      <Button
        label="Gönder"
        disabled={busy}
        accessibilityHint={busy ? 'Önceki mesajın cevabı bekleniyor' : 'Mesajı asistana gönderir'}
        onPress={send}
      />
    );
  } else {
    action = <Button label="Konuş" accessibilityHint="Söylediğini Türkçe olarak kutuya yazar" onPress={speech.start} />;
  }

  return (
    <View style={[styles.container, { paddingBottom: spacing.sm + bottomInset }]}>
      {speech.error ? (
        <AppText variant="labelMd" tone="critical" accessibilityRole="alert">
          {speech.error}
        </AppText>
      ) : null}
      {speech.listening ? (
        <AppText variant="labelMd" tone="primary" accessibilityLiveRegion="polite">
          Dinleniyor… Konuşman bitince metin kutuya yazılır.
        </AppText>
      ) : null}
      <View style={styles.row}>
        <TextField
          value={value}
          onChangeText={changeText}
          placeholder="Mesaj yaz veya konuş…"
          accessibilityLabel="Mesaj"
          multiline
          maxLength={MESSAGE_TEXT_MAX_LENGTH}
          style={styles.input}
        />
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    // Tek satırda metin 48'lik kutunun ortasında: (48 − 24 satır yüksekliği) / 2. Kutu en fazla beş satır uzar.
    paddingVertical: 12,
    maxHeight: 24 * 5 + 24,
    textAlignVertical: 'top',
  },
});
