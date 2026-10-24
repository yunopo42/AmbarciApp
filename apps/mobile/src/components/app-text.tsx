import type { JSX } from 'react';
import { Text } from 'react-native';
import type { TextProps } from 'react-native';

import { colors, tabularNums, typography } from '@/theme';
import type { TypographyVariant } from '@/theme';

const TONES = {
  text: colors.text,
  muted: colors.textMuted,
  subtle: colors.textSubtle,
  primary: colors.primary,
  critical: colors.critical,
  applied: colors.applied,
  onPrimary: colors.onPrimary,
} as const;

export type TextTone = keyof typeof TONES;

/** Uygulamanın metni: yazı ölçeği ve renk tema dosyasından (docs/tasarim.md). Sayılarda `tabular` kullanılır. */
export function AppText({
  variant = 'bodyMd',
  tone = 'text',
  tabular = false,
  style,
  ...props
}: TextProps & { variant?: TypographyVariant; tone?: TextTone; tabular?: boolean }): JSX.Element {
  return <Text style={[typography[variant], { color: TONES[tone] }, tabular ? tabularNums : null, style]} {...props} />;
}
