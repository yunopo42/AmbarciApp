// Uygulama yapılandırması: app.json'u temel alır ve Supabase'in herkese açık ayarlarını ekler.
// Yerelde depo kökündeki .env dosyasından yalnızca EXPO_PUBLIC_ ile başlayan değişkenler okunur;
// backend anahtarları (service role, veritabanı, Claude) uygulama paketine girmez.
// EAS'te değerler EAS ortam değişkenlerinden gelir.
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

const rootEnvFile = path.join(__dirname, '../../.env');
if (existsSync(rootEnvFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnvFile, 'utf8')))) {
    if (key.startsWith('EXPO_PUBLIC_')) {
      process.env[key] ??= value;
    }
  }
}

/** @param {import('expo/config').ConfigContext} context */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    // Uygulama bu değerleri expo-constants ile okur (src/lib/supabase.ts).
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // API adresi (src/lib/api.ts). Telefon "localhost"a ulaşamaz: Render adresi ya da bilgisayarın ağ adresi.
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
  },
});
