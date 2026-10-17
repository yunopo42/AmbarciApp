import { Stack } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useState } from 'react';
import type { JSX } from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

// Geçici deneme ekranı: Türkçe ses tanımayı eval/ses-denemesi.md cümleleriyle sınamak için.
// Ses tanımanın sohbete bağlanması 7. haftanın işi; bu ekran o zaman kaldırılacak.
const LOCALE = 'tr-TR';

export default function SpeechTestScreen(): JSX.Element {
  const [listening, setListening] = useState(false);
  const [current, setCurrent] = useState('');
  const [finals, setFinals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    if (event.isFinal) {
      setCurrent('');
      setFinals((previous) => [...previous, transcript]);
    } else {
      setCurrent(transcript);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    setError(`${event.error}: ${event.message}`);
  });

  async function handleStart(): Promise<void> {
    setError(null);
    setCurrent('');

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError('Mikrofon izni verilmedi. Telefon ayarlarından Ambarcı için mikrofon iznini açın.');
      return;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError('Bu cihazda ses tanıma servisi bulunamadı. Google uygulamasının kurulu ve açık olduğunu kontrol edin.');
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: LOCALE,
      interimResults: true,
      continuous: false,
    });
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Ses tanıma denemesi' }} />

      <Text>Düğmeye basıp cümleyi söyleyin. Tanıma dili: {LOCALE}</Text>

      {listening ? (
        <Button title="Durdur" onPress={() => ExpoSpeechRecognitionModule.stop()} />
      ) : (
        <Button title="Mikrofonu aç" onPress={() => void handleStart()} />
      )}

      {listening ? <Text>Dinleniyor… {current}</Text> : null}
      {error ? <Text accessibilityRole="alert">Hata: {error}</Text> : null}

      <ScrollView style={styles.results}>
        {finals.length === 0 ? <Text>Henüz tanınan cümle yok.</Text> : null}
        {finals.map((transcript, index) => (
          <Text key={index} selectable>
            {index + 1}. {transcript}
          </Text>
        ))}
      </ScrollView>

      {finals.length > 0 ? <Button title="Listeyi temizle" onPress={() => setFinals([])} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 16,
    padding: 16,
  },
  results: {
    flex: 1,
  },
});
