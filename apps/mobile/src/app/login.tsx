import { useState } from 'react';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';

// Tasarım değerleri (renk, yazı tipi, boşluk) docs/tasarim.md hazırlanınca uygulanacak (#20).
// Hesaplar yönetici davetiyle açılacak (#18); bu yüzden kayıt ekranı yok.
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
    <View style={styles.container}>
      <Text style={styles.title}>Ambarcı</Text>
      <TextInput
        style={styles.input}
        placeholder="E-posta"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextInput
        style={styles.input}
        placeholder="Şifre"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={() => void handleSubmit()}
        style={styles.button}
      >
        <Text>{pending ? 'Giriş yapılıyor…' : 'Giriş yap'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
  },
  button: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
    alignItems: 'center',
  },
});
