// ai modülü gerçek veritabanında: her model çağrısı ai_runs'a yazılır (başarısız olanlar dahil), maliyet SQL'de
// hesaplanır, modelin reddi ve yarım cevap Türkçe hataya çevrilir, günlük token bütçesi uygulanır. Claude çağrılmaz;
// yerine sahte sağlayıcı kullanılır. Oluşturulan her şey sonunda silinir.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiException } from '../src/common/api-exception.js';
import type { AiConfig } from '../src/modules/ai/ai.config.js';
import { AiProviderError } from '../src/modules/ai/ai-provider.js';
import type { AiTurnRequest } from '../src/modules/ai/ai-provider.js';
import { AiRunsRepository } from '../src/modules/ai/ai-runs.repository.js';
import { AiService } from '../src/modules/ai/ai.service.js';
import type { AiCallContext } from '../src/modules/ai/ai.service.js';
import { aiResult, ScriptedAiProvider } from '../test/support/scripted-ai-provider.js';
import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

const CONFIG: AiConfig = {
  apiKey: null,
  chatModel: 'claude-haiku-5-5',
  chatEffort: 'low',
  dailyTokenLimitPerUser: 10_000,
  dailyTokenLimitPerOrganization: 25_000,
};

const REQUEST: AiTurnRequest = { system: 'Sen saha stok asistanısın.', tools: [], messages: [] };

// interface değil type: Drizzle'ın execute<T>() satır tipi indeks imzası ister.
type RunRow = {
  model: string;
  promptVersion: string;
  effort: string | null;
  toolCalls: string[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  firstTokenMs: number | null;
  costUsd: string;
  stopReason: string | null;
  errorCode: string | null;
};

describe('ai modülü (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let employee = '';
  let message = '';
  const provider = new ScriptedAiProvider();
  let service: AiService;

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Asistan' });
    employee = await fx.addMember('EMPLOYEE');
    service = new AiService(fx.db, provider, new AiRunsRepository(), CONFIG);

    // Model çağrısı bir kullanıcı mesajına bağlanır (yabancı anahtar): sohbet ve ilk mesaj önceden yazılır.
    const conversation = randomUUID();
    message = randomUUID();
    await fx.db.execute(sql`insert into conversations (id, organization_id, user_id) values (${conversation}, ${fx.org}, ${fx.admin})`);
    await fx.db.execute(sql`insert into messages (id, organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
      values (${message}, ${fx.org}, ${conversation}, ${fx.admin}, 1, 'USER',
              ${JSON.stringify([{ type: 'text', text: 'Merkez depoda NYM kablodan kaç metre var?' }])}::jsonb,
              ${randomUUID()}, 'IN_PROGRESS')`);
  });

  afterAll(async () => {
    await fx?.close();
  });

  const context = (roundNo: number): AiCallContext => ({
    organizationId: fx.org,
    userId: fx.admin,
    messageId: message,
    roundNo,
    promptVersion: 'chat-v1',
  });

  async function runOf(roundNo: number): Promise<RunRow | undefined> {
    const [row] = await fx.db.execute<RunRow>(sql`
      select model, prompt_version as "promptVersion", effort, tool_calls as "toolCalls", input_tokens as "inputTokens",
             output_tokens as "outputTokens", duration_ms as "durationMs", first_token_ms as "firstTokenMs",
             cost_usd as "costUsd", stop_reason as "stopReason", error_code as "errorCode"
      from ai_runs where message_id = ${message} and round_no = ${roundNo}`);
    return row;
  }

  async function apiErrorOf(promise: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
    const error: unknown = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiException);
    const apiError = error as ApiException;
    return { status: apiError.getStatus(), code: apiError.code, message: apiError.message };
  }

  it('başarılı çağrı, maliyeti dört token türüyle SQL\'de hesaplanarak yazılır', async () => {
    provider.push(
      aiResult({
        stopReason: 'tool_use',
        toolCalls: [{ id: 'toolu_1', name: 'get_stock', input: { product_id: 'p-1' } }],
        usage: { inputTokens: 1200, outputTokens: 85, cacheReadInputTokens: 900, cacheCreationInputTokens: 3000 },
        durationMs: 1650,
        firstTokenMs: 640,
      }),
    );
    const result = await service.createTurn(context(1), REQUEST);
    expect(result.stopReason).toBe('tool_use');

    // (1200 × 0,10 + 3000 × 0,125 + 900 × 0,01 + 85 × 0,50) / 1.000.000 = 546,5 / 1.000.000
    expect(await runOf(1)).toEqual({
      model: 'claude-haiku-5-5',
      promptVersion: 'chat-v1',
      effort: 'low',
      toolCalls: ['get_stock'],
      inputTokens: 1200,
      outputTokens: 85,
      durationMs: 1650,
      firstTokenMs: 640,
      costUsd: '0.00054650',
      stopReason: 'tool_use',
      errorCode: null,
    });
  });

  it('istem 100K tokenı aşınca uzun istem fiyatı uygulanır', async () => {
    provider.push(aiResult({ usage: { inputTokens: 150_000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }));
    await service.createTurn(context(2), REQUEST);
    // (150.000 × 0,50 + 100 × 2,50) / 1.000.000
    expect((await runOf(2))?.costUsd).toBe('0.07525000');
  });

  it('model reddederse çağrı kaydedilir ve AI_REFUSED (Türkçe mesajla) döner', async () => {
    provider.push(aiResult({ stopReason: 'refusal', text: '' }));
    const error = await apiErrorOf(service.createTurn(context(3), REQUEST));
    expect(error).toMatchObject({ status: 422, code: 'AI_REFUSED' });
    expect(error.message).toMatch(/cevap veremedi/);
    // Reddedilen çağrının tokenları da faturalanır: (1200 × 0,10 + 85 × 0,50) / 1.000.000
    expect(await runOf(3)).toMatchObject({ stopReason: 'refusal', errorCode: null, costUsd: '0.00016250' });
  });

  it('araç çağrısı yazılırken çıktı sınırına takılan cevap çalıştırılmaz: AI_RESPONSE_TRUNCATED', async () => {
    provider.push(
      aiResult({ stopReason: 'max_tokens', toolCalls: [{ id: 'toolu_9', name: 'search_products', input: { query: 'ny' } }] }),
    );
    expect(await apiErrorOf(service.createTurn(context(4), REQUEST))).toMatchObject({ status: 502, code: 'AI_RESPONSE_TRUNCATED' });
    expect((await runOf(4))?.stopReason).toBe('max_tokens');
  });

  it('sağlayıcı hatası sıfır tokenla ve hata koduyla kaydedilir, kullanıcıya Türkçe hata döner', async () => {
    provider.push(new AiProviderError('AI_RATE_LIMITED', 'Claude API istek sınırına ulaşıldı.', 250));
    const error = await apiErrorOf(service.createTurn(context(5), REQUEST));
    expect(error).toMatchObject({ status: 503, code: 'AI_RATE_LIMITED' });
    expect(error.message).toMatch(/yoğun/);
    expect(await runOf(5)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 250,
      costUsd: '0.00000000',
      stopReason: null,
      errorCode: 'AI_RATE_LIMITED',
    });
  });

  it('anahtar tanımlı değilse istek gönderilmemiştir; çağrı kaydedilmez', async () => {
    provider.push(new AiProviderError('AI_NOT_CONFIGURED', 'ANTHROPIC_API_KEY tanımlı değil.', 0));
    expect(await apiErrorOf(service.createTurn(context(6), REQUEST))).toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' });
    expect(await runOf(6)).toBeUndefined();
  });

  describe('günlük token bütçesi (kullanıcı 10.000, şirket 25.000)', () => {
    const other = randomUUID();

    /** Bütçe sayımı için doğrudan ai_runs satırı (giriş tokenı olarak). */
    const addUsage = (organizationId: string, userId: string, tokens: number, yesterday = false): Promise<unknown> =>
      fx.db.execute(sql`insert into ai_runs (organization_id, user_id, round_no, model, prompt_version, input_tokens, duration_ms, cost_usd, created_at)
        values (${organizationId}, ${userId}, 1, 'claude-haiku-5-5', 'chat-v1', ${tokens}, 1000, 0,
                ${yesterday ? sql`date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul' - interval '1 minute'` : sql`now()`})`);

    const budgetError = (organizationId: string, userId: string): Promise<{ status: number; code: string; message: string } | null> =>
      service.assertWithinBudget(organizationId, userId).then(
        () => null,
        (error: unknown) => {
          expect(error).toBeInstanceOf(ApiException);
          const apiError = error as ApiException;
          return { status: apiError.getStatus(), code: apiError.code, message: apiError.message, ...(apiError.details as object) };
        },
      );

    beforeAll(async () => {
      // Önceki testlerin çağrıları sayıma girmesin.
      await fx.db.execute(sql`delete from ai_runs where organization_id = ${fx.org}`);
      await fx.db.execute(sql`insert into organizations (id, name) values (${other}, ${`Asistan B ${other.slice(0, 8)}`})`);
    });

    afterAll(async () => {
      await fx.db.execute(sql`delete from ai_runs where organization_id = ${other}`);
      await fx.db.execute(sql`delete from organizations where id = ${other}`);
    });

    it('dünkü kullanım ve başka şirketteki kullanım sayılmaz', async () => {
      await addUsage(fx.org, fx.admin, 50_000, true);
      await addUsage(other, fx.admin, 1_000_000);
      await addUsage(fx.org, fx.admin, 8_000);
      expect(await budgetError(fx.org, fx.admin)).toBeNull();
    });

    it('kullanıcı kendi sınırına ulaşınca 429 AI_BUDGET_EXCEEDED alır; aynı şirketteki başka kullanıcı etkilenmez', async () => {
      await addUsage(fx.org, fx.admin, 2_500);
      expect(await budgetError(fx.org, fx.admin)).toMatchObject({
        status: 429,
        code: 'AI_BUDGET_EXCEEDED',
        scope: 'user',
        limit: 10_000,
        used: 10_500,
      });
      await addUsage(fx.org, employee, 9_000);
      expect(await budgetError(fx.org, employee)).toBeNull();
    });

    it('şirketin toplamı sınıra ulaşınca bütün kullanıcılar şirket mesajını alır', async () => {
      await addUsage(fx.org, employee, 6_000);
      const forAdmin = await budgetError(fx.org, fx.admin);
      expect(forAdmin).toMatchObject({ status: 429, code: 'AI_BUDGET_EXCEEDED', scope: 'organization', used: 25_500 });
      expect(forAdmin?.message).toMatch(/Şirketinizin/);
      expect(await budgetError(fx.org, employee)).toMatchObject({ scope: 'organization' });
    });
  });
});
