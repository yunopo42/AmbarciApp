import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';

// Geçici giriş ekranı. Sohbet ekranı ve tasarım değerleri sonraki haftalarda gelecek.
export default function HomeScreen(): JSX.Element {
  const { session, signOut } = useAuth();
  const [pending, setPending] = useState(false);

  async function handleSignOut(): Promise<void> {
    setPending(true);
    await signOut();
    // Çıkıştan sonra giriş ekranına geçişi _layout.tsx'teki korumalı yığın yapar.
  }

  return (
    <View style={styles.container}>
      <Text>Ambarcı saha uygulaması kurulum aşamasında.</Text>
      {session?.user.email ? <Text>Giriş yapan: {session.user.email}</Text> : null}
      {/* Geçici: deneme ekranı kaldırılınca bu bağlantı da kaldırılacak. */}
      <Link href="/speech-test">Ses tanıma denemesi</Link>
      <Pressable
        accessibilityRole="button"
        disabled={pending}
        onPress={() => void handleSignOut()}
        style={styles.button}
      >
        <Text>{pending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  button: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 12,
  },
});
