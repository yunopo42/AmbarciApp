import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { createChunkedStorage } from './chunked-storage';

interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

// app.config.js, EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY değerlerini "extra" altına koyar.
// İkisi de herkese açık değerlerdir; service role ve Claude anahtarı uygulamaya asla girmez.
function readConfig(): SupabasePublicConfig {
  const extra = Constants.expoConfig?.extra as { supabaseUrl?: unknown; supabaseAnonKey?: unknown } | undefined;
  const url = extra?.supabaseUrl;
  const anonKey = extra?.supabaseAnonKey;
  if (typeof url !== 'string' || !url || typeof anonKey !== 'string' || !anonKey) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı (depo kökündeki .env).');
  }
  return { url, anonKey };
}

const { url, anonKey } = readConfig();

/**
 * Uygulamanın tek Supabase istemcisi. Oturum (erişim ve yenileme token'ları) cihazın güvenli
 * deposunda tutulur: Android'de Keystore, iOS'ta Keychain.
 */
export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    storage: createChunkedStorage(SecureStore),
    persistSession: true,
    autoRefreshToken: true,
    // Giriş e-posta ve şifreyle yapılır; tarayıcı yönlendirmesiyle gelen oturum yok.
    detectSessionInUrl: false,
  },
});
