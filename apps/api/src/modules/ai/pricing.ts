import type { AiUsage } from './ai-provider.js';

/**
 * Milyon token başına dolar. Değerler metindir ve JS'te hesaba girmez: maliyet SQL'de NUMERIC ile hesaplanır
 * (ADR-003). Önbelleğe yazma 5 dakikalık önbellek içindir (girişin 1,25 katı), önbellekten okuma girişin 0,1 katı.
 */
export interface TokenPrices {
  input: string;
  output: string;
  cacheWrite: string;
  cacheRead: string;
}

interface ModelPricing {
  standard: TokenPrices;
  /** İstem bu sınırı aşarsa uygulanan fiyat (Haiku 5.5'te 100K token). */
  longPrompt?: { thresholdTokens: number; prices: TokenPrices };
}

// Kaynak: claude-api skill'indeki model tablosu (2026-10-06) ve Haiku 5.5 geçiş notu. Fiyat değişirse yalnızca
// yeni kayıtlar yeni fiyatla hesaplanır; eski ai_runs satırlarının maliyeti çağrı anındaki fiyatla kalır.
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-haiku-5-5': {
    standard: { input: '0.10', output: '0.50', cacheWrite: '0.125', cacheRead: '0.01' },
    longPrompt: { thresholdTokens: 100_000, prices: { input: '0.50', output: '2.50', cacheWrite: '0.625', cacheRead: '0.05' } },
  },
  // Belge okuma modeli (7. hafta).
  'claude-sonnet-5-5': {
    standard: { input: '2.00', output: '10.00', cacheWrite: '2.50', cacheRead: '0.20' },
  },
};

export function hasPricing(model: string): boolean {
  return Object.hasOwn(MODEL_PRICING, model);
}

/** Çağrıya uygulanacak fiyatlar. İstem uzunluğu token sayılarından (tam sayı) bulunur; para hesabı yapılmaz. */
export function pricesFor(model: string, usage: AiUsage): TokenPrices {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    throw new Error(`${model} için fiyat tanımlı değil (modules/ai/pricing.ts).`);
  }
  const promptTokens = usage.inputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
  if (pricing.longPrompt && promptTokens > pricing.longPrompt.thresholdTokens) {
    return pricing.longPrompt.prices;
  }
  return pricing.standard;
}
