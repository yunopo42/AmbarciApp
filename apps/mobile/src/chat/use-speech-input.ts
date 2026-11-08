import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';
import { useCallback, useEffect, useState } from 'react';

// Ses tanıma cihazda yapılır (telefonun ses tanıma servisi, tr-TR); ses dosyası sunucuya gitmez, saklanmaz. Tanınan
// metin kutuya yazılır; kullanıcı düzeltip kendisi gönderir (1. hafta denemesi: eval/ses-denemesi.md).

const LOCALE = 'tr-TR';

const ERROR_MESSAGES: Partial<Record<ExpoSpeechRecognitionErrorCode, string>> = {
  'no-speech': 'Ses algılanmadı. "Konuş"a basıp tekrar dene.',
  'speech-timeout': 'Ses algılanmadı. "Konuş"a basıp tekrar dene.',
  'not-allowed': 'Mikrofon izni verilmedi. Telefon ayarlarından Ambarcı için mikrofon iznini aç.',
  'service-not-allowed': 'Ses tanıma servisi kullanılamıyor. Google uygulamasının kurulu ve açık olduğunu kontrol et.',
  'language-not-supported': 'Bu cihazda Türkçe ses tanıma yok. Mesajı yazarak gönderebilirsin.',
  network: 'Ses tanıma için internet bağlantısı gerekiyor.',
  'audio-capture': 'Mikrofon kullanılamıyor. Başka bir uygulama mikrofonu kullanıyor olabilir.',
  busy: 'Ses tanıma meşgul. Biraz sonra tekrar dene.',
  interrupted: 'Ses tanıma yarıda kesildi. Tekrar dene.',
};
const DEFAULT_ERROR = 'Ses tanınamadı. Tekrar dene ya da mesajı yaz.';

export interface SpeechInput {
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Uyarıyı kaldırır: kullanıcı kutuya yazınca ya da mesajı gönderince uyarı artık geçerli değildir. */
  clearError: () => void;
}

/**
 * "Konuş" düğmesinin durumu. `onTranscript` konuşma sürerken tanınan metnin o ana kadarki hâliyle (ara sonuç), sonda
 * da son hâliyle çağrılır; her çağrı öncekinin yerine geçer.
 */
export function useSpeechInput(onTranscript: (transcript: string) => void): SpeechInput {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) {
      onTranscript(transcript);
    }
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    // Kullanıcının kendisi durdurduğu tanıma hata sayılmaz.
    if (event.error !== 'aborted') {
      setError(ERROR_MESSAGES[event.error] ?? DEFAULT_ERROR);
    }
  });

  // Ekrandan çıkılırsa mikrofon açık kalmaz.
  useEffect(() => () => ExpoSpeechRecognitionModule.abort(), []);

  const start = useCallback((): void => {
    setError(null);
    void (async () => {
      try {
        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission.granted) {
          setError(ERROR_MESSAGES['not-allowed'] ?? DEFAULT_ERROR);
          return;
        }
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          setError(ERROR_MESSAGES['service-not-allowed'] ?? DEFAULT_ERROR);
          return;
        }
        ExpoSpeechRecognitionModule.start({ lang: LOCALE, interimResults: true, continuous: false });
      } catch {
        setError(DEFAULT_ERROR);
      }
    })();
  }, []);

  const stop = useCallback((): void => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const clearError = useCallback((): void => setError(null), []);

  return { listening, error, start, stop, clearError };
}
