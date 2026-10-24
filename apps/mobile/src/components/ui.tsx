import { useState } from 'react';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { PressableProps, TextInputProps, ViewProps } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, radius, shadows, spacing, touchTarget, typography } from '@/theme';

// Mobil ekranların ortak parçaları; değerler src/theme.ts'ten (docs/tasarim.md "Bileşen kuralları").

/** Kart: zemin card, kenarlık border, köşe 12, iç boşluk 16, gölge seviye 1. */
export function Card({ style, ...props }: ViewProps): JSX.Element {
  return <View style={[styles.card, style]} {...props} />;
}

/**
 * Durum rozeti: hap biçimi, dikey 4 / yatay 10, label-sm. Mobilde büyük harf metnin kendisinde yazılır ("KRİTİK"):
 * React Native'in textTransform'u Türkçe "i"yi "İ" yapmaz.
 */
export function StatusBadge({ status, label }: { status: 'critical' | 'applied'; label: string }): JSX.Element {
  const critical = status === 'critical';
  return (
    <View
      style={[
        styles.badge,
        critical
          ? { backgroundColor: colors.criticalSoft, borderColor: colors.criticalBorder }
          : { backgroundColor: colors.appliedSoft, borderColor: colors.appliedBorder },
      ]}
    >
      <AppText variant="labelSm" tone={critical ? 'critical' : 'applied'}>
        {label}
      </AppText>
    </View>
  );
}

/** Filtre çipi (depo seçimi): seçiliyken primary dolgu. Dokunma alanı 48. */
export function Chip({ label, selected, ...props }: PressableProps & { label: string; selected: boolean }): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        pressed && !selected ? { backgroundColor: colors.primarySoft } : null,
      ]}
      {...props}
    >
      <AppText variant="labelLg" tone={selected ? 'onPrimary' : 'text'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Ana ve ikincil düğme: en az 48 yükseklik, yatay 20, köşe 8, label-lg (mobil panellerde tam genişlik). */
export function Button({
  label,
  variant = 'primary',
  ...props
}: PressableProps & { label: string; variant?: 'primary' | 'secondary' }): JSX.Element {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        primary ? { backgroundColor: pressed ? colors.primaryAction : colors.primary } : styles.buttonSecondary,
        pressed && !primary ? { backgroundColor: colors.primarySoft } : null,
        props.disabled ? { opacity: 0.5 } : null,
      ]}
      {...props}
    >
      <AppText variant="labelLg" tone={primary ? 'onPrimary' : 'primary'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * Giriş alanı: en az 48, kenarlık 1,5 border-strong, köşe 8. Odakta kenarlık 2 px primary-action olur (tasarımdaki
 * odak halkasının mobil karşılığı).
 */
export function TextField({ style, onFocus, onBlur, ...props }: TextInputProps): JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.textSubtle}
      style={[styles.input, focused ? styles.inputFocused : null, style]}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      {...props}
    />
  );
}

/** Yükleniyor, hata ya da boş liste mesajı; hatada "Tekrar dene". */
export function StateMessage({
  loading = false,
  message,
  onRetry,
}: {
  loading?: boolean;
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <AppText tone="muted" style={styles.stateText}>
        {message}
      </AppText>
      {onRetry ? <Button label="Tekrar dene" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.level1,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: 10,
  },
  chip: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  button: {
    minHeight: touchTarget,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  input: {
    minHeight: touchTarget,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    color: colors.text,
    ...typography.bodyLg,
  },
  inputFocused: {
    borderColor: colors.primaryAction,
    borderWidth: 2,
  },
  state: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  stateText: {
    textAlign: 'center',
  },
});
