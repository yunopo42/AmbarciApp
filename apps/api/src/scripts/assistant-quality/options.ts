// pnpm eval seçenekleri. Komut satırı aracı (cli.ts) seçenekleri doğrular ve ortam değişkeni olarak vitest'e geçirir;
// koşucu (test-db/assistant.quality.ts) aynı şemayla geri okur. Böylece iki taraf aynı kurala bakar.
import { z } from 'zod';

import { AI_EFFORTS } from '../../modules/ai/ai-provider.js';
import type { AiEffort } from '../../modules/ai/ai-provider.js';
import { hasPricing } from '../../modules/ai/pricing.js';
import { hasChatPrompt } from '../../modules/ai/prompts/index.js';
import type { SetSelection } from './cases.js';

export interface RunOptions {
  set: SetSelection;
  /** Yalnızca bu kimlikler (boşsa kümenin tamamı). */
  only: string[];
  /** Boşsa .env'deki CLAUDE_CHAT_MODEL (yoksa ADR-001'deki model). */
  model: string | null;
  effort: AiEffort | null;
  /** Prompt sürümü (ör. "chat-v3"). Boşsa .env'deki CLAUDE_CHAT_PROMPT, o da yoksa güncel sürüm. */
  prompt: string | null;
  /** Aynı anda koşan mesaj sayısı. */
  concurrency: number;
  /** Sonuç dosyasının adına eklenir (ör. "prompt-v3"). */
  label: string | null;
}

const ENV = {
  set: 'ASSISTANT_QUALITY_SET',
  only: 'ASSISTANT_QUALITY_ONLY',
  model: 'ASSISTANT_QUALITY_MODEL',
  effort: 'ASSISTANT_QUALITY_EFFORT',
  prompt: 'ASSISTANT_QUALITY_PROMPT',
  concurrency: 'ASSISTANT_QUALITY_CONCURRENCY',
  label: 'ASSISTANT_QUALITY_LABEL',
} as const;

type RawOptions = Partial<Record<keyof typeof ENV, string>>;

const blankToUndefined = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const optionsSchema = z.object({
  set: z.preprocess(blankToUndefined, z.enum(['dev', 'test', 'all'], { error: '--set dev, test ya da all olmalı.' }).default('dev')),
  only: z.preprocess(blankToUndefined, z.string().optional()).transform((value) =>
    value
      ? value
          .split(',')
          .map((id) => id.trim().toUpperCase())
          .filter((id) => id !== '')
      : [],
  ),
  model: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine(hasPricing, { error: '--model için fiyat tanımlı değil (modules/ai/pricing.ts); maliyet hesaplanamaz.' })
      .optional(),
  ),
  effort: z.preprocess(blankToUndefined, z.enum(AI_EFFORTS, { error: `--effort şunlardan biri olmalı: ${AI_EFFORTS.join(', ')}.` }).optional()),
  prompt: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .refine(hasChatPrompt, { error: '--prompt tanımlı bir prompt sürümü olmalı (ör. chat-v2, chat-v3).' })
      .optional(),
  ),
  concurrency: z.preprocess(
    blankToUndefined,
    z.coerce.number({ error: '--concurrency bir sayı olmalı.' }).int().min(1).max(6, { error: '--concurrency en fazla 6 olabilir.' }).default(3),
  ),
  label: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/, { error: '--label küçük harf, rakam ve tire içerebilir (en fazla 40 karakter).' })
      .optional(),
  ),
});

export function parseRunOptions(raw: RawOptions): RunOptions {
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(' '));
  }
  const { set, only, model, effort, prompt, concurrency, label } = parsed.data;
  return { set, only, model: model ?? null, effort: effort ?? null, prompt: prompt ?? null, concurrency, label: label ?? null };
}

export function runOptionsToEnv(options: RunOptions): Record<string, string> {
  return {
    [ENV.set]: options.set,
    [ENV.only]: options.only.join(','),
    [ENV.model]: options.model ?? '',
    [ENV.effort]: options.effort ?? '',
    [ENV.prompt]: options.prompt ?? '',
    [ENV.concurrency]: String(options.concurrency),
    [ENV.label]: options.label ?? '',
  };
}

export function runOptionsFromEnv(env: NodeJS.ProcessEnv): RunOptions {
  return parseRunOptions({
    set: env[ENV.set],
    only: env[ENV.only],
    model: env[ENV.model],
    effort: env[ENV.effort],
    prompt: env[ENV.prompt],
    concurrency: env[ENV.concurrency],
    label: env[ENV.label],
  });
}
