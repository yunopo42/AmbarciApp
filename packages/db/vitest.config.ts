import { defineConfig } from 'vitest/config';

// Gerçek Supabase veritabanına bağlanan testler: pnpm db:test
// CI'daki "pnpm test" bunları çalıştırmaz (veritabanı bilgisi CI'da yok).
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // Her test uzak veritabanında bir transaction açıp kapatır; süre ağ gecikmesiyle doğru orantılı (gidiş-dönüş
    // 24 Ekim'de ~80 ms, 6 Kasım'da ~170 ms ölçüldü). Sınır API'nin gerçek veritabanı testleriyle aynı.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
