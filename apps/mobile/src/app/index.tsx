import { StatusBar } from 'expo-status-bar';
import type { JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// Geçici giriş ekranı. Sohbet ekranı ve tasarım değerleri sonraki haftalarda gelecek.
export default function HomeScreen(): JSX.Element {
  return (
    <View style={styles.container}>
      <Text>Ambarcı saha uygulaması kurulum aşamasında.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
