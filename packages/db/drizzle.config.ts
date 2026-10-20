import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'drizzle-kit';

// drizzle-kit bu dosyayı CommonJS olarak yüklediği için import.meta.url kullanılamaz.
// Komutlar paket klasöründen çalışır (pnpm db:generate, pnpm db:migrate); depo kökündeki
// .env buradan okunur.
const envFile = path.resolve('../../.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
}

export default defineConfig({
  dialect: 'postgresql',
  // Tek giriş noktası: aynı tablo hem kendi dosyasından hem index'ten iki kez okunmasın.
  schema: './schema/index.ts',
  out: './migrations',
  dbCredentials: { url: databaseUrl },
  // Supabase'in hazır rolleri (anon, authenticated, service_role) RLS politikalarında
  // kullanılabilir; drizzle-kit bunları oluşturmaya veya silmeye çalışmaz.
  entities: { roles: { provider: 'supabase' } },
});
