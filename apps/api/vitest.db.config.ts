import { defineConfig } from 'vitest/config';

// API'yi gerçek Supabase veritabanıyla çalıştıran testler: pnpm db:test
// CI'daki "pnpm test" bunları çalıştırmaz (veritabanı bilgisi CI'da yok). Token'lar testte üretilen
// anahtarla imzalanır; Supabase Auth'a gidilmez.
export default defineConfig({
  test: {
    include: ['test-db/**/*.spec.ts'],
    // Dosyalar sırayla çalışır. Her dosya kendi API'sini ve bağlantı havuzunu açıyor; Supabase'in oturum havuzu
    // (session pooler, 5432) aynı anda en fazla 15 istemciye izin veriyor. Paralel çalışınca beşinci dosyada sınır
    // aşıldı (EMAXCONNSESSION).
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      SUPABASE_URL: 'https://test-project.supabase.co',
    },
  },
});
