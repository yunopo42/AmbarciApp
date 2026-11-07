// Çalışan bir API'ye (varsayılan: Render) karşı ölçüm yapan betiklerin ortak parçaları: .env, ölçüm kullanıcısıyla
// giriş ve uyuyan servisi uyandırma. Kullanan betikler: measure-confirm-remote.ts (#34), measure-chat-remote.ts (#60).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

// Derlenmiş dosya apps/api/dist/scripts/ altında çalışır; dört üst klasör depo köküdür.
export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** Depo kökündeki .env dosyasını (varsa) ortam değişkenlerine yükler. */
export function loadRepoEnv(): void {
  const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} tanımlı değil (.env).`);
  }
  return value;
}

/** Ölçülen API'nin adresi: MEASURE_API_URL, yoksa Render. */
export function measureApiUrl(): string {
  return (process.env.MEASURE_API_URL?.trim() || 'https://ambarci-api.onrender.com').replace(/\/$/, '');
}

const signInSchema = z.object({ access_token: z.string(), user: z.object({ id: z.uuid() }) });

/** Ölçüm kullanıcısıyla Supabase Auth'a e-posta + şifreyle giriş yapar; token yalnızca bellekte tutulur. */
export async function signIn(): Promise<{ token: string; userId: string }> {
  const response = await fetch(`${required('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: required('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: required('MEASURE_EMAIL'), password: required('MEASURE_PASSWORD') }),
  });
  if (!response.ok) {
    throw new Error(`Supabase girişi başarısız (${response.status}). MEASURE_EMAIL ve MEASURE_PASSWORD'ü kontrol edin.`);
  }
  const body = signInSchema.parse(await response.json());
  return { token: body.access_token, userId: body.user.id };
}

/** Render'ın ücretsiz planı 15 dakika istek almazsa uyur; ilk istekte bir dakikaya kadar sürebilir. */
export async function wakeUp(apiUrl: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(`${apiUrl}/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Uyanırken bağlantı reddedilebilir; tekrar denenir.
    }
    if (Date.now() > deadline) {
      throw new Error(`${apiUrl} iki dakikada cevap vermedi.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}
