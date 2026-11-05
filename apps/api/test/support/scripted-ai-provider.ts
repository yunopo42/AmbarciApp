import { AIProvider, AiProviderError } from '../../src/modules/ai/ai-provider.js';
import type { AiTurnRequest, AiTurnResult } from '../../src/modules/ai/ai-provider.js';

// Testlerde Claude'un yerine geçen sağlayıcı: sıraya konan cevapları (ya da hataları) sırayla döner ve gelen istekleri
// saklar. Gerçek model çağrısı yapılmaz; ajan döngüsü ve SSE testleri de bunu kullanır.

/** Varsayılanları dolu bir model cevabı; testler yalnızca değişen alanları verir. */
export function aiResult(overrides: Partial<AiTurnResult> = {}): AiTurnResult {
  const text = overrides.text ?? 'Merkez depoda 120 metre var.';
  return {
    model: 'claude-haiku-5-5',
    effort: 'low',
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    toolCalls: [],
    usage: { inputTokens: 1200, outputTokens: 85, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    durationMs: 1500,
    firstTokenMs: 600,
    ...overrides,
    text,
  };
}

export class ScriptedAiProvider extends AIProvider {
  readonly model = 'claude-haiku-5-5';
  readonly effort = 'low' as const;
  /** Sağlayıcıya gelen istekler, sırasıyla. */
  readonly requests: AiTurnRequest[] = [];
  private readonly script: (AiTurnResult | AiProviderError)[] = [];

  /** Sıradaki çağrıların cevaplarını ekler. */
  push(...steps: (AiTurnResult | AiProviderError)[]): this {
    this.script.push(...steps);
    return this;
  }

  async createTurn(request: AiTurnRequest): Promise<AiTurnResult> {
    this.requests.push(request);
    const step = this.script.shift();
    if (!step) {
      throw new Error('ScriptedAiProvider: sırada cevap yok.');
    }
    if (step instanceof AiProviderError) {
      throw step;
    }
    // Metin, kelime kelime parça olarak akar (boşluklar korunur).
    for (const delta of step.text.match(/\S+\s*/g) ?? []) {
      request.onTextDelta?.(delta);
    }
    return step;
  }
}
