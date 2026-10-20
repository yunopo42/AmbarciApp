import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    env: {
      // AuthModule açılışta bu değeri ister. Testler ağa çıkmaz: JWKS ilk doğrulamada
      // indirilir ve token doğrulayan testler yerel anahtarlı doğrulayıcı kullanır.
      SUPABASE_URL: 'https://test-project.supabase.co',
    },
  },
});
