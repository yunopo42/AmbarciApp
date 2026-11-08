// ai modülünün veritabanı ve ağ gerektirmeyen kuralları: ortam değişkenleri, fiyat seçimi, prompt sürümleri ve
// sahte sağlayıcı.
import { describe, expect, it } from 'vitest';

import { readAiConfig } from '../src/modules/ai/ai.config.js';
import { AiProviderError } from '../src/modules/ai/ai-provider.js';
import { pricesFor } from '../src/modules/ai/pricing.js';
import { ALL_CHAT_PROMPTS, CURRENT_CHAT_PROMPT, chatPrompt } from '../src/modules/ai/prompts/index.js';
import { aiResult, ScriptedAiProvider } from './support/scripted-ai-provider.js';

describe('Asistan ayarları (ortam değişkenleri)', () => {
  it('tanımsız ya da boş değişkenlerde ADR-001 seçimi ve varsayılan bütçe kullanılır; anahtar yoksa asistan kapalıdır', () => {
    const expected = {
      apiKey: null,
      chatModel: 'claude-haiku-5-5',
      chatEffort: 'low',
      dailyTokenLimitPerUser: 500_000,
      dailyTokenLimitPerOrganization: 2_000_000,
    };
    expect(readAiConfig({})).toEqual(expected);
    expect(
      readAiConfig({ ANTHROPIC_API_KEY: '', CLAUDE_CHAT_MODEL: ' ', CLAUDE_CHAT_EFFORT: '', AI_DAILY_TOKEN_LIMIT_USER: '' }),
    ).toEqual(expected);
  });

  it('verilen değerleri okur', () => {
    expect(
      readAiConfig({
        ANTHROPIC_API_KEY: ' sk-ant-test ',
        CLAUDE_CHAT_MODEL: 'claude-haiku-5-5',
        CLAUDE_CHAT_EFFORT: 'medium',
        AI_DAILY_TOKEN_LIMIT_USER: '1000',
        AI_DAILY_TOKEN_LIMIT_ORG: '5000',
      }),
    ).toEqual({
      apiKey: 'sk-ant-test',
      chatModel: 'claude-haiku-5-5',
      chatEffort: 'medium',
      dailyTokenLimitPerUser: 1000,
      dailyTokenLimitPerOrganization: 5000,
    });
  });

  it('geçersiz değer açılışta hata verir', () => {
    expect(() => readAiConfig({ CLAUDE_CHAT_EFFORT: 'none' })).toThrow(/CLAUDE_CHAT_EFFORT/);
    expect(() => readAiConfig({ AI_DAILY_TOKEN_LIMIT_USER: '0' })).toThrow(/AI_DAILY_TOKEN_LIMIT_USER/);
    expect(() => readAiConfig({ AI_DAILY_TOKEN_LIMIT_ORG: 'çok' })).toThrow(/AI_DAILY_TOKEN_LIMIT_ORG/);
    // Fiyatı bilinmeyen modelin maliyeti yazılamaz.
    expect(() => readAiConfig({ CLAUDE_CHAT_MODEL: 'claude-bilinmeyen' })).toThrow(/fiyat tanımlı değil/);
  });
});

describe('Model fiyatları', () => {
  const usage = (inputTokens: number, cacheReadInputTokens = 0): Parameters<typeof pricesFor>[1] => ({
    inputTokens,
    outputTokens: 100,
    cacheReadInputTokens,
    cacheCreationInputTokens: 0,
  });

  it('Haiku 5.5: istem 100K tokenı aşınca uzun istem fiyatı uygulanır (önbellek tokenları dahil)', () => {
    expect(pricesFor('claude-haiku-5-5', usage(50_000)).input).toBe('0.10');
    expect(pricesFor('claude-haiku-5-5', usage(60_000, 40_000)).input).toBe('0.10');
    expect(pricesFor('claude-haiku-5-5', usage(60_000, 40_001))).toEqual({
      input: '0.50',
      output: '2.50',
      cacheWrite: '0.625',
      cacheRead: '0.05',
    });
  });

  it('fiyatı bilinmeyen model hata verir', () => {
    expect(() => pricesFor('claude-bilinmeyen', usage(10))).toThrow(/fiyat tanımlı değil/);
  });
});

describe('Prompt sürümleri', () => {
  it('sürüm bilinmiyorsa güncel sürüm (chat-v2), biliniyorsa o sürüm döner; eski sürüm silinmez', () => {
    expect(chatPrompt()).toBe(CURRENT_CHAT_PROMPT);
    expect(CURRENT_CHAT_PROMPT.version).toBe('chat-v2');
    expect(chatPrompt('chat-v1').version).toBe('chat-v1');
    expect(chatPrompt('chat-v0')).toBe(CURRENT_CHAT_PROMPT);
    expect(ALL_CHAT_PROMPTS.map((prompt) => prompt.version)).toEqual(['chat-v1', 'chat-v2']);
  });

  it('her sürümün promptu kendi araçlarını adıyla anar', () => {
    for (const prompt of ALL_CHAT_PROMPTS) {
      for (const tool of prompt.tools) {
        expect(prompt.text, `${prompt.version}: ${tool}`).toContain(tool);
      }
    }
  });

  it('chat-v1 4. haftadaki gibi kalır: stok değiştiremeyeceğini söyler, öneri aracı yoktur', () => {
    const v1 = chatPrompt('chat-v1');
    expect(v1.text).toContain('Stoğu değiştiremezsin');
    expect(v1.tools).toEqual(['search_products', 'list_warehouses', 'get_stock', 'list_recent_movements']);
  });

  it('chat-v2: onay kullanıcının, Markdown yok, toplam görebildiği depolarda, hitap "sen"', () => {
    const { text } = chatPrompt('chat-v2');
    expect(text).toContain("kartta Onayla'ya basınca");
    expect(text).toContain('Sen onaylayamazsın');
    expect(text).toContain('onaylandığını ya da stoğun değiştiğini asla söyleme');
    expect(text).toContain('Markdown kullanma');
    expect(text).toContain('görebildiğin depolarda');
    expect(text).toContain('"sen" diye hitap et');
    expect(text).toContain('operation_id');
    // Metin sabittir: tarih ya da şirket adı gibi değişen bilgi yok (önbellek, ADR-001).
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}|ABC Elektrik/);
  });
});

describe('Sahte sağlayıcı (testler için)', () => {
  it('cevapları sırayla döner, metni parça parça akıtır, hatayı fırlatır ve istekleri saklar', async () => {
    const provider = new ScriptedAiProvider().push(
      aiResult({ text: 'Merkez depoda 120 metre var.' }),
      new AiProviderError('AI_OVERLOADED', 'yoğun', 10),
    );
    const deltas: string[] = [];
    const request = { system: 's', tools: [], messages: [], onTextDelta: (text: string) => deltas.push(text) };

    await expect(provider.createTurn(request)).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(deltas.join('')).toBe('Merkez depoda 120 metre var.');
    expect(deltas.length).toBeGreaterThan(1);
    await expect(provider.createTurn(request)).rejects.toMatchObject({ code: 'AI_OVERLOADED' });
    await expect(provider.createTurn(request)).rejects.toThrow(/sırada cevap yok/);
    expect(provider.requests).toHaveLength(3);
  });
});
