import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ApiProvider } from '@/api/api-provider';
import { OrganizationProvider } from '@/api/organization-provider';
import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { colors, fonts, typography } from '@/theme';

// Ekran başlıkları da tasarım değerleriyle: card zemin, title-md, primary geri düğmesi, canvas sayfa zemini.
const screenOptions = {
  headerStyle: { backgroundColor: colors.card },
  headerTitleStyle: { fontFamily: fonts.semiBold, fontSize: typography.titleMd.fontSize, color: colors.text },
  headerTintColor: colors.primary,
  contentStyle: { backgroundColor: colors.canvas },
} as const;

export default function RootLayout(): JSX.Element {
  return (
    <AuthProvider>
      <RootStack />
      <StatusBar style="dark" />
    </AuthProvider>
  );
}

function RootStack(): JSX.Element {
  const { session, isLoading } = useAuth();
  // Yalnızca kullanılan dört ağırlık pakete girer (ağırlık başına ayrı dosya).
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });

  // Yazı tipi yüklenemezse uygulama sistem yazı tipiyle açılır; beklemede kalmaz.
  if (isLoading || (!fontsLoaded && !fontError)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isLoggedIn = session !== null;
  // Oturum yokken yalnızca giriş ekranı açılır; oturum açılınca ya da kapanınca Expo Router kullanıcıyı uygun
  // ekrana kendisi geçirir.
  const stack = (
    <Stack screenOptions={screenOptions}>
      <Stack.Protected guard={isLoggedIn}>
        <Stack.Screen name="index" options={{ title: 'Stok' }} />
        <Stack.Screen name="products/[productId]" options={{ title: 'Ürün' }} />
        <Stack.Screen name="account" options={{ title: 'Hesap' }} />
        <Stack.Screen name="speech-test" options={{ title: 'Ses tanıma denemesi' }} />
      </Stack.Protected>
      <Stack.Protected guard={!isLoggedIn}>
        <Stack.Screen name="login" options={{ title: 'Giriş', headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
  if (!session) {
    return stack;
  }
  // API istemcisi ve önbelleği kullanıcıya bağlı: başka hesapla girilince baştan kurulur, önceki veri görünmez.
  return (
    <ApiProvider key={session.user.id}>
      <OrganizationProvider>{stack}</OrganizationProvider>
    </ApiProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
});
