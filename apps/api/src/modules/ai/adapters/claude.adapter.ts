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

  constructor(options: ClaudeAdapterOptions) {
    super();
    this.model = options.model;
    this.effort = options.effort;
    // 429, 5xx ve bağlantı hatalarını SDK kendisi iki kez yeniden dener (varsayılan).
    this.client = options.apiKey ? new Anthropic({ timeout: 60_000, ...options.client, apiKey: options.apiKey }) : null;
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
      throw toProviderError(error, elapsed());
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

/** SDK hatalarını port hatasına çevirir; en özelden en genele (alt sınıflar önce). */
function toProviderError(error: unknown, durationMs: number): unknown {
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
    return new AiProviderError('AI_REQUEST_REJECTED', `Claude API isteği reddetti (${error.status}): ${error.message}`, durationMs);
  }
  if (error instanceof Anthropic.InternalServerError && error.status === 529) {
    return new AiProviderError('AI_OVERLOADED', 'Claude API aşırı yüklü (529).', durationMs);
  }
  if (error instanceof Anthropic.APIError) {
    // Bağlantı hatası, zaman aşımı ve diğer 5xx.
    return new AiProviderError('AI_UNAVAILABLE', `Claude API'ye ulaşılamadı: ${error.message}`, durationMs);
  }
  // Programlama hatası: olduğu gibi yukarı çıkar.
  return error;
}
