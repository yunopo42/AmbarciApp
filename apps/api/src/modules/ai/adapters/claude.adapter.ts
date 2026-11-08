import { performance } from 'node:perf_hooks';

import type { MessageContentBlock } from '@ambarci/db';
import Anthropic from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';

import { AIProvider, AiProviderError } from '../ai-provider.js';
import type { AiEffort, AiToolCall, AiTurnRequest, AiTurnResult } from '../ai-provider.js';

// Claude SDK'sı projede yalnızca bu klasörde import edilir (mimari değişmez 9).

/**
 * Düşünmeye pay bırakan çıktı sınırı. ADR-001: en az 4.096; 2. hafta denemesinde yetti. Sınıra takılan cevap
 * stop_reason: "max_tokens" ile döner (ai.service bunu ele alır).
 */
export const CHAT_MAX_TOKENS = 4096;

/**
 * Claude API'nin adresi; bilerek kodda sabit. Adres verilmezse SDK ANTHROPIC_BASE_URL ortam değişkenini okur: o
 * değişken başka bir araç için tanımlıysa istekler ve API anahtarı oraya gider (4. haftada geliştirici bilgisayarında
 * 127.0.0.1:1337'ye gitti). Testler kendi adresini ClaudeAdapterOptions.client ile verebilir.
 */
export const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';

export interface ClaudeAdapterOptions {
  apiKey: string | null;
  model: string;
  effort: AiEffort;
  /** Testte sahte fetch, yeniden deneme sayısı gibi SDK ayarları. */
  client?: Omit<ClientOptions, 'apiKey'>;
}

export class ClaudeAdapter extends AIProvider {
  readonly model: string;
  readonly effort: AiEffort;
  private readonly client: Anthropic | null;
  private readonly apiKey: string | null;

  constructor(options: ClaudeAdapterOptions) {
    super();
    this.model = options.model;
    this.effort = options.effort;
    this.apiKey = options.apiKey;
    // 429, 5xx ve bağlantı hatalarını SDK kendisi iki kez yeniden dener (varsayılan). Adres options.client'tan önce
    // gelir: üretimde sabit adres geçerli, test kendi adresini ya da sahte fetch'ini verebilir.
    this.client = options.apiKey
      ? new Anthropic({ baseURL: CLAUDE_API_BASE_URL, timeout: 60_000, ...options.client, apiKey: options.apiKey })
      : null;
  }

  async createTurn(request: AiTurnRequest): Promise<AiTurnResult> {
    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    if (!this.client) {
      throw new AiProviderError('AI_NOT_CONFIGURED', 'ANTHROPIC_API_KEY tanımlı değil.', 0);
    }

    let firstTokenMs: number | null = null;
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: CHAT_MAX_TOKENS,
          // Haiku 5.5'te varsayılan da budur; açıkça yazılır. temperature, top_p ve top_k bilerek gönderilmez:
          // Haiku 5.5 ve 2026-10-21 API sürümü bunları reddeder (ADR-001).
          thinking: { type: 'adaptive' },
          output_config: { effort: this.effort },
          // Önbellek: sistem bloğundaki işaret araç tanımlarını ve sistem promptunu (sırayla gönderilirler), üst
          // düzeydeki işaret de geçmişin sonuna kadarını önbelleğe alır. Araç turunun ikinci çağrısı aynı ön eki okur.
          cache_control: { type: 'ephemeral' },
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          // eager_input_streaming bilerek kapalı: araç girdileri birkaç düzine bayt, strict şemayı API'nin
          // doğrulaması daha değerli (açıkken API girdiyi doğrulamaz).
          ...(request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
                  strict: true,
                })),
              }
            : {}),
          messages: request.messages.map((message) => ({
            role: message.role,
            // Saklanan bloklar API'nin kendi döndürdüğü bloklardır; değiştirilmeden geri gönderilir.
            content: message.content as unknown as Anthropic.ContentBlockParam[],
          })),
        },
        { signal: request.signal },
      );
      stream.on('text', (delta) => {
        firstTokenMs ??= elapsed();
        request.onTextDelta?.(delta);
      });
      const message = await stream.finalMessage();
      return toResult(message, this.effort, elapsed(), firstTokenMs);
    } catch (error) {
      throw toProviderError(error, elapsed(), { host: new URL(this.client.baseURL).host, apiKey: this.apiKey });
    }
  }
}

function toResult(message: Anthropic.Message, effort: AiEffort, durationMs: number, firstTokenMs: number | null): AiTurnResult {
  const toolCalls: AiToolCall[] = [];
  const texts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, input: block.input });
    } else if (block.type === 'text') {
      texts.push(block.text);
    }
  }
  return {
    model: message.model,
    effort,
    // Düz JSON'a çevrilir: messages.content'e olduğu gibi yazılır ve sonraki istekte aynen geri gönderilir.
    content: JSON.parse(JSON.stringify(message.content)) as MessageContentBlock[],
    stopReason: message.stop_reason,
    toolCalls,
    text: texts.join(''),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
    durationMs,
    firstTokenMs,
  };
}

interface ErrorContext {
  /** İsteğin gittiği sunucu (ör. api.anthropic.com); bağlantı hatasında nereye gidilemediği görünsün. */
  host: string;
  /** Hata metnine karışırsa loga yazılmadan önce silinir. */
  apiKey: string | null;
}

/** Hata zincirindeki en fazla bu kadar neden okunur (döngüye karşı). */
const MAX_CAUSE_DEPTH = 4;

/**
 * Bağlantı hatasının alttaki nedeni. SDK bağlantı hatasında yalnızca "Connection error." yazar; asıl neden `cause`
 * zincirindedir (Node'un fetch'i: "fetch failed" → "connect ECONNREFUSED 127.0.0.1:1337"). Zincirdeki mesajlar ve hata
 * kodları sırayla birleştirilir. Nedeni olmayan hatada boş metin döner.
 */
export function describeErrorCause(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      const code = (current as Error & { code?: unknown }).code;
      const text = typeof code === 'string' && !current.message.includes(code) ? `${current.message} (${code})` : current.message;
      parts.push(text);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' ← ');
}

/** Metindeki API anahtarını siler. Anahtar normalde hata mesajlarında geçmez; bu son savunma hattıdır. */
function redact(text: string, apiKey: string | null): string {
  return apiKey ? text.split(apiKey).join('[anahtar gizlendi]') : text;
}

/**
 * SDK hatalarını port hatasına çevirir; en özelden en genele (alt sınıflar önce). Mesaj yalnızca loga yazılır
 * (ai.service); kullanıcı genel bir Türkçe mesaj görür. Mesaja istek ya da cevap içeriği konmaz.
 */
function toProviderError(error: unknown, durationMs: number, context: ErrorContext): unknown {
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AiProviderError('AI_ABORTED', 'Model çağrısı iptal edildi.', durationMs);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('AI_RATE_LIMITED', 'Claude API istek sınırına ulaşıldı.', durationMs);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('AI_AUTH_FAILED', `Claude API anahtarı reddedildi (${error.status}).`, durationMs);
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    // Bizim isteğimizde bir hata var (ör. geçmiş bozuk); mesaj loga gider, kullanıcıya genel hata gösterilir.
    const message = `Claude API isteği reddetti (${error.status}): ${error.message}`;
    return new AiProviderError('AI_REQUEST_REJECTED', redact(message, context.apiKey), durationMs);
  }
  if (error instanceof Anthropic.InternalServerError && error.status === 529) {
    return new AiProviderError('AI_OVERLOADED', 'Claude API aşırı yüklü (529).', durationMs);
  }
  if (error instanceof Anthropic.APIError) {
    // Bağlantı hatası, zaman aşımı ve diğer 5xx. Logda hedef sunucu ve alttaki neden görünsün: 4. haftada
    // "Connection error." yazısından adresin yanlış olduğu anlaşılamamıştı.
    const cause = describeErrorCause(error);
    const message = `Claude API'ye ulaşılamadı (${context.host}): ${error.message}${cause ? ` Neden: ${cause}` : ''}`;
    return new AiProviderError('AI_UNAVAILABLE', redact(message, context.apiKey), durationMs);
  }
  // Programlama hatası: olduğu gibi yukarı çıkar.
  return error;
}
