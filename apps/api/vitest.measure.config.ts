import { defineConfig } from 'vitest/config';

// Gecikme ölçümü (test değil): pnpm measure:latency
// Gerçek Supabase veritabanına bağlanır; pnpm test ve pnpm db:test bunu çalıştırmaz.
export default defineConfig({
  test: {
    include: ['test-db/**/*.measure.ts'],
    testTimeout: 900_000,
    hookTimeout: 120_000,
    env: {
      SUPABASE_URL: 'https://test-project.supabase.co',
    },
  },
});
