import { Stack } from 'expo-router';
import type { JSX } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/auth-provider';

export default function RootLayout(): JSX.Element {
  return (
    <AuthProvider>
      <RootStack />
    </AuthProvider>
  );
}

function RootStack(): JSX.Element {
  const { session, isLoading } = useAuth();
  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  const isLoggedIn = session !== null;
  // Oturum yokken yalnızca giriş ekranı açılır; oturum açılınca ya da kapanınca Expo Router
  // kullanıcıyı uygun ekrana kendisi geçirir.
  return (
    <Stack screenOptions={{ title: 'Ambarcı' }}>
      <Stack.Protected guard={isLoggedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="speech-test" />
      </Stack.Protected>
      <Stack.Protected guard={!isLoggedIn}>
        <Stack.Screen name="login" options={{ title: 'Giriş' }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
