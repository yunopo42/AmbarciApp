import { defineConfig } from 'vitest/config';

// API'yi gerçek Supabase veritabanıyla çalıştıran testler: pnpm db:test
// CI'daki "pnpm test" bunları çalıştırmaz (veritabanı bilgisi CI'da yok). Token'lar testte üretilen
// anahtarla imzalanır; Supabase Auth'a gidilmez.
export default defineConfig({
  test: {
    include: ['test-db/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      SUPABASE_URL: 'https://test-project.supabase.co',
    },
  },
});
