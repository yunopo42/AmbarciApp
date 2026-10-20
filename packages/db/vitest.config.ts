import { defineConfig } from 'vitest/config';

// Gerçek Supabase veritabanına bağlanan testler: pnpm db:test
// CI'daki "pnpm test" bunları çalıştırmaz (veritabanı bilgisi CI'da yok).
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // Her test uzak veritabanında bir transaction açıp kapatır.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
