import type { TextStyle, ViewStyle } from 'react-native';

// Tasarım değerleri: docs/tasarim.md ile birebir aynıdır; değer değişecekse önce o dosya güncellenir. Mobilde tek
// kaynak bu dosya (web'de apps/web/app/globals.css). Ekranlar renk kodu ya da sayı yazmaz, buradan alır.

export const colors = {
  primary: '#1E3A8A',
  primaryAction: '#1D4ED8',
  onPrimary: '#FFFFFF',
  primarySoft: '#EFF4FF',
  text: '#0B1C30',
  textMuted: '#444651',
  textSubtle: '#757682',

  canvas: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  divider: '#F1F5F9',

  // Durum renkleri: metin, dolgu (nokta, grafik), zemin (soft), kenarlık
  pending: '#D97706',
  pendingFill: '#F59E0B',
  pendingSoft: '#FEF3C7',
  pendingBorder: '#FDE68A',
  applied: '#059669',
  appliedFill: '#10B981',
  appliedSoft: '#ECFDF5',
  appliedBorder: '#A7F3D0',
  critical: '#DC2626',
  criticalFill: '#DC2626',
  criticalSoft: '#FEF2F2',
  criticalBorder: '#FECACA',
} as const;

/**
 * Inter, ağırlık başına ayrı dosya (src/app/_layout.tsx'te yüklenir). React Native'de özel yazı tipiyle `fontWeight`
 * Android'de çalışmaz; ağırlık, dosyanın kendisiyle seçilir.
 */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

// Harf aralığı tasarımda em cinsinden; React Native nokta istediği için boyutla çarpıldı (ör. −0.01em × 26 = −0.26).
export const typography = {
  headlineLgMobile: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 34, letterSpacing: -0.26 },
  headlineMd: { fontFamily: fonts.semiBold, fontSize: 24, lineHeight: 32, letterSpacing: -0.24 },
  headlineSm: { fontFamily: fonts.semiBold, fontSize: 20, lineHeight: 28 },
  titleMd: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 24 },
  bodyLg: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyLgBold: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 24 },
  bodyMd: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  bodyMdMedium: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  labelLg: { fontFamily: fonts.semiBold, fontSize: 15, lineHeight: 20, letterSpacing: 0.15 },
  labelMd: { fontFamily: fonts.semiBold, fontSize: 13, lineHeight: 18, letterSpacing: 0.26 },
  labelSm: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.44 },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/** 8 px ızgara: space-xs … space-xl. Mobilde kenar boşluğu ve öğeler arası `md` (16). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

/** Mobilde her dokunulabilir öğe en az 48 × 48 (eldivenle ya da acele ederken). */
export const touchTarget = 48;

// Gölge rengi tasarımdaki rgba(15, 23, 42, …) tonu. Android gölgeyi `elevation` ile çizer; iOS shadow* ile.
const shadowColor = '#0F172A';

export const shadows = {
  level1: { shadowColor, shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  level2: { shadowColor, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  level3: { shadowColor, shadowOpacity: 0.12, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
} satisfies Record<string, ViewStyle>;

/** Sayılar (stok, ürün kodu) alt alta hizalı dursun diye eşit genişlikli rakamlarla. */
export const tabularNums: TextStyle = { fontVariant: ['tabular-nums'] };
