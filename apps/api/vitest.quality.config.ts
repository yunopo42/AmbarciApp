import { defineConfig } from 'vitest/config';

// Asistanın değerlendirme koşusu (test değil, ölçüm): pnpm eval
// Gerçek Supabase veritabanına bağlanır ve GERÇEK model çağrısı yapar; pnpm test ve pnpm db:test bunu çalıştırmaz.
export default defineConfig({
  test: {
    include: ['test-db/**/*.quality.ts'],
    // 100 mesaj, yavaş bir modelle bir saate yaklaşabilir.
    testTimeout: 7_200_000,
    hookTimeout: 600_000,
    env: {
      SUPABASE_URL: 'https://test-project.supabase.co',
    },
  },
});
