import { aiRuns } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { AiUsage } from './ai-provider.js';
import type { TokenPrices } from './pricing.js';

export interface AiRunEntry {
  organizationId: string;
  /** Hesap silinince boşalır; yazılırken her zaman doludur. */
  userId: string;
  messageId: string | null;
  roundNo: number;
  model: string;
  promptVersion: string;
  effort: string | null;
  toolCalls: string[];
  usage: AiUsage;
  durationMs: number;
  firstTokenMs: number | null;
  /** Çağrıya uygulanan fiyatlar (pricing.ts). */
  prices: TokenPrices;
  stopReason: string | null;
  errorCode: string | null;
}

// interface değil type: Drizzle'ın execute<T>() satır tipi indeks imzası ister.
type DailyUsageRow = { userTokens: string; organizationTokens: string };

export interface DailyTokenUsage {
  /** Kullanıcının bu şirketteki bugünkü tokenları. */
  user: number;
  organization: number;
}

/** Model çağrısı kayıtları (ai_runs) yalnızca eklenir; güncelleme ve silme yolu bilerek yoktur. */
@Injectable()
export class AiRunsRepository {
  async insert(executor: DbExecutor, entry: AiRunEntry): Promise<{ id: string; costUsd: string }> {
    const { usage, prices } = entry;
    const [row] = await executor
      .insert(aiRuns)
      .values({
        organizationId: entry.organizationId,
        userId: entry.userId,
        messageId: entry.messageId,
        roundNo: entry.roundNo,
        model: entry.model,
        promptVersion: entry.promptVersion,
        effort: entry.effort,
        toolCalls: entry.toolCalls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        durationMs: entry.durationMs,
        firstTokenMs: entry.firstTokenMs,
        // Maliyet SQL'de NUMERIC ile hesaplanır (ADR-003): her token türü kendi milyon token fiyatıyla çarpılır,
        // toplam 1.000.000'a bölünür ve kolonun ölçeğinde (8 hane) yuvarlanır.
        costUsd: sql`round((
            ${usage.inputTokens}::numeric * ${prices.input}::numeric
          + ${usage.cacheCreationInputTokens}::numeric * ${prices.cacheWrite}::numeric
          + ${usage.cacheReadInputTokens}::numeric * ${prices.cacheRead}::numeric
          + ${usage.outputTokens}::numeric * ${prices.output}::numeric
        ) / 1000000, 8)`,
        stopReason: entry.stopReason,
        errorCode: entry.errorCode,
      })
      .returning({ id: aiRuns.id, costUsd: aiRuns.costUsd });
    if (!row) {
      throw new Error('ai_runs kaydı yazılamadı.');
    }
    return row;
  }

  /** Verilen mesajlara bağlı ilk model çağrısının prompt sürümü; çağrı yoksa null. */
  async firstPromptVersion(executor: DbExecutor, organizationId: string, messageIds: string[]): Promise<string | null> {
    if (messageIds.length === 0) {
      return null;
    }
    const [row] = await executor.execute<{ promptVersion: string }>(sql`
      select prompt_version as "promptVersion"
      from ${aiRuns}
      where organization_id = ${organizationId}::uuid
        and message_id in (${sql.join(
          messageIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
      order by created_at
      limit 1`);
    return row?.promptVersion ?? null;
  }

  /**
   * Bugün (Türkiye saatiyle gece yarısından beri) harcanan tokenlar: giriş, çıkış ve önbellek tokenlarının toplamı.
   * (şirket, zaman) indeksiyle tek sorgu; kullanıcının payı aynı satırlardan süzülür.
   */
  async dailyTokenUsage(executor: DbExecutor, organizationId: string, userId: string): Promise<DailyTokenUsage> {
    const [row] = await executor.execute<DailyUsageRow>(sql`
      select coalesce(sum(tokens) filter (where user_id = ${userId}::uuid), 0)::text as "userTokens",
             coalesce(sum(tokens), 0)::text as "organizationTokens"
      from (
        select user_id,
               input_tokens::bigint + output_tokens + cache_read_input_tokens + cache_creation_input_tokens as tokens
        from ${aiRuns}
        where organization_id = ${organizationId}::uuid
          and created_at >= date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'
      ) as today`);
    // Token sayıları tam sayıdır; günlük toplam JS'in güvenli tam sayı sınırının çok altında kalır.
    return { user: Number(row?.userTokens ?? 0), organization: Number(row?.organizationTokens ?? 0) };
  }
}
