import { useState } from 'react';
import type { JSX } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { AppText } from '@/components/app-text';
import { Button, Card, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

// Hesaplar web panelinden açılır ve şirkete davet koduyla katılınır (#18); bu yüzden mobilde kayıt ekranı yok.
export default function LoginScreen(): JSX.Element {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(): Promise<void> {
    setPending(true);
    setError(null);
    const message = await signIn(email, password);
    if (message) {
      setError(message);
      setPending(false);
    }
    // Başarılı girişte ana ekrana geçişi _layout.tsx'teki korumalı yığın yapar.
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <AppText variant="headlineSm" tone="onPrimary">
            A
          </AppText>
        </View>
        <AppText variant="headlineLgMobile" tone="primary">
          Ambarcı
        </AppText>
      </View>
      <Card style={styles.form}>
        <AppText variant="headlineSm">Giriş yap</AppText>
        <TextField
          placeholder="E-posta"
          accessibilityLabel="E-posta"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          placeholder="Şifre"
          accessibilityLabel="Şifre"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
        />
        {error ? (
          <AppText accessibilityRole="alert" variant="labelMd" tone="critical">
            {error}
          </AppText>
        ) : null}
        <Button label={pending ? 'Giriş yapılıyor…' : 'Giriş yap'} disabled={pending} onPress={() => void handleSubmit()} />
      </Card>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.canvas,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    gap: spacing.md,
  },
});
