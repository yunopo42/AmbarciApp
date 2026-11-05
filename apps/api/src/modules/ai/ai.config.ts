import { z } from 'zod';

import { AI_EFFORTS } from './ai-provider.js';
import type { AiEffort } from './ai-provider.js';
import { hasPricing } from './pricing.js';

/** ai modülünün ayarları. Değerler ortam değişkenlerinden okunur (ADR-001: model ve effort env'de). */
export interface AiConfig {
  /**
   * Boşsa asistan kapalıdır: model çağrısı AI_NOT_CONFIGURED (503) döner, API'nin geri kalanı çalışmaya devam eder.
   * Anahtar yalnızca backend'de tutulur (mimari değişmez 12).
   */
  apiKey: string | null;
  chatModel: string;
  chatEffort: AiEffort;
  /** Kullanıcı başına günlük token bütçesi (giriş, çıkış ve önbellek tokenları toplamı). */
  dailyTokenLimitPerUser: number;
  /** Şirket başına günlük token bütçesi. */
  dailyTokenLimitPerOrganization: number;
}

export const AI_CONFIG = Symbol('AI_CONFIG');

// Boş bırakılmış değişken (ANTHROPIC_API_KEY=) tanımsız sayılır.
const optionalText = z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().trim().optional());
const tokenLimit = (fallback: number): z.ZodType<number> =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : undefined),
    z.number().int().positive().default(fallback),
  );

const envSchema = z.object({
  ANTHROPIC_API_KEY: optionalText,
  CLAUDE_CHAT_MODEL: optionalText,
  CLAUDE_CHAT_EFFORT: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined),
    z.enum(AI_EFFORTS).default('low'),
  ),
  // Kullanıcı başına ~55 mesaj, şirket başına ~220 mesaj (2. hafta denemesinde mesaj başına ~9.000 token).
  AI_DAILY_TOKEN_LIMIT_USER: tokenLimit(500_000),
  AI_DAILY_TOKEN_LIMIT_ORG: tokenLimit(2_000_000),
});

/**
 * Ortam değişkenlerini okur. Geçersiz değer açılışta hata verir: yanlış yazılmış bir effort ya da fiyatı bilinmeyen
 * bir model, ilk sohbette değil deploy sırasında görünür. Model tanımlı değilse ADR-001'deki seçim kullanılır.
 */
export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Asistan ayarları geçersiz: ${fields}. .env.example dosyasındaki Claude bölümüne bakın.`);
  }
  const chatModel = parsed.data.CLAUDE_CHAT_MODEL ?? 'claude-haiku-5-5';
  if (!hasPricing(chatModel)) {
    throw new Error(
      `CLAUDE_CHAT_MODEL=${chatModel} için fiyat tanımlı değil (modules/ai/pricing.ts). Maliyet ai_runs'a yazılamayacağı için API açılmıyor.`,
    );
  }
  return {
    apiKey: parsed.data.ANTHROPIC_API_KEY ?? null,
    chatModel,
    chatEffort: parsed.data.CLAUDE_CHAT_EFFORT,
    dailyTokenLimitPerUser: parsed.data.AI_DAILY_TOKEN_LIMIT_USER,
    dailyTokenLimitPerOrganization: parsed.data.AI_DAILY_TOKEN_LIMIT_ORG,
  };
}
