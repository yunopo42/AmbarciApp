import type { MessageContentBlock } from '@ambarci/db';

// Dil modeli portu (mimari değişmez 9). Asistan modülü modeli yalnızca bu arayüzle çağırır; Claude SDK'sı yalnızca
// adapters/ altında import edilir. Model sağlayıcısı değişirse ya da testte sahte bir sağlayıcı kullanılırsa yalnızca
// AIProvider'ın uygulaması değişir.

export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Modelin düşünme düzeyi (ADR-001: sohbette low). */
export type AiEffort = (typeof AI_EFFORTS)[number];

/** Modele verilen bir araç. Şema, assistant/tools kayıt defterindeki strict JSON şemasıdır. */
export interface AiToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Modele gönderilen geçmişin bir mesajı. İçerik, messages tablosunda saklanan bloklarla aynıdır ve değiştirilmeden
 * gönderilir: düşünme blokları dahil (ADR-001). Araç sonuçları da "user" rolüyle gider.
 */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: MessageContentBlock[];
}

export interface AiTurnRequest {
  /** Sürümlü sistem promptunun metni (ai/prompts). */
  system: string;
  tools: AiToolDefinition[];
  messages: AiMessage[];
  /** Her metin parçası geldiğinde çağrılır; asistan bunu SSE ile istemciye aktarır. */
  onTextDelta?: (text: string) => void;
  /** Çağrıyı yarıda kesmek için (ör. sunucu kapanırken). */
  signal?: AbortSignal;
}

export interface AiUsage {
  /** Önbellekten okunmayan ve önbelleğe yazılmayan giriş tokenları. */
  inputTokens: number;
  /** Düşünme tokenları dahil. */
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AiToolCall {
  id: string;
  name: string;
  /** Modelin ürettiği girdi; asistan kayıt defterindeki şemayla yeniden doğrular. */
  input: unknown;
}

/** Tek bir model çağrısının sonucu. */
export interface AiTurnResult {
  /** API'nin bildirdiği model. */
  model: string;
  effort: AiEffort | null;
  /** Modelin döndürdüğü bloklar (düşünme, metin, araç çağrısı); messages tablosuna olduğu gibi yazılır. */
  content: MessageContentBlock[];
  /** end_turn, tool_use, refusal, max_tokens… */
  stopReason: string | null;
  toolCalls: AiToolCall[];
  /** Metin bloklarının birleşimi. */
  text: string;
  usage: AiUsage;
  /** İsteğin gönderilmesinden cevabın bitmesine kadar. */
  durationMs: number;
  /** İlk metin parçasına kadar; yalnızca araç çağıran cevapta boş. */
  firstTokenMs: number | null;
}

export type AiProviderErrorCode =
  /** Anahtar tanımlı değil; istek gönderilmedi. */
  | 'AI_NOT_CONFIGURED'
  /** Anahtar reddedildi (401/403). */
  | 'AI_AUTH_FAILED'
  | 'AI_RATE_LIMITED'
  | 'AI_OVERLOADED'
  | 'AI_UNAVAILABLE'
  | 'AI_REQUEST_REJECTED'
  | 'AI_ABORTED';

/** Sağlayıcı hatası. Adaptör SDK'nın hata sınıflarını buna çevirir; SDK sınıfları ai modülünün dışına çıkmaz. */
export class AiProviderError extends Error {
  constructor(
    readonly code: AiProviderErrorCode,
    message: string,
    /** Hataya kadar geçen süre (ai_runs kaydı için). */
    readonly durationMs: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Soyut sınıf, Nest'te enjeksiyon anahtarı olarak da kullanılır. */
export abstract class AIProvider {
  abstract readonly model: string;
  abstract readonly effort: AiEffort | null;
  /** Modeli bir kez çağırır (araç turu döngüsü asistan modülünde). Hata durumunda AiProviderError fırlatır. */
  abstract createTurn(request: AiTurnRequest): Promise<AiTurnResult>;
}
