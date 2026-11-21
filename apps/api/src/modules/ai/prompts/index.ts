import { CHAT_PROMPT_V1 } from './chat.v1.js';
import { CHAT_PROMPT_V2 } from './chat.v2.js';
import { CHAT_PROMPT_V3 } from './chat.v3.js';

/**
 * Sürümlü sistem promptu ve o sürümün araç listesi. Sürüm, ai_runs.prompt_version'a yazılır; sonuçlar sürüme göre
 * kıyaslanır. Araç listesi de sürümün parçasıdır: süren bir sohbette araç listesi değişirse geri gönderilen düşünme
 * blokları geçersiz olur ve önbellek bozulur (ADR-001). Yeni araç eklemek yeni bir prompt sürümü demektir.
 */
export interface ChatPrompt {
  version: string;
  text: string;
  /** Modele gönderilen araçlar (assistant/tools kayıt defterindeki adlar); kayıt defterindeki sırayla gönderilir. */
  tools: readonly string[];
  /**
   * Araç şemalarında zorunlu alanlar önce, isteğe bağlılar sonra (chat-v3, #86). Alan sırası da araç tanımının
   * parçasıdır; eski sürümlerde değişmez ki süren sohbetlerin tanımı aynı kalsın (ADR-001).
   */
  requiredFieldsFirst?: boolean;
}

/**
 * Yeni sohbetlerde kullanılan sürüm. chat-v3 (21 Kasım, #86): değerlendirme kümesinin geliştirme yarısında Haiku 5.5
 * (low) ile chat-v2 55–56/60, chat-v3 60/60 (iki koşu). Kıyas: docs/degerlendirme.md. CLAUDE_CHAT_PROMPT ile deploy
 * etmeden eski sürüme dönülebilir.
 */
export const CURRENT_CHAT_PROMPT: ChatPrompt = CHAT_PROMPT_V3;

// Eski sürümler silinmez: süren bir sohbet başladığı sürümle (metni ve araçlarıyla) devam edebilmeli. Sohbetin
// ortasında sistem promptu değişirse geri gönderilen düşünme blokları geçersiz olur (ADR-001).
const CHAT_PROMPTS: ReadonlyMap<string, ChatPrompt> = new Map([
  [CHAT_PROMPT_V1.version, CHAT_PROMPT_V1],
  [CHAT_PROMPT_V2.version, CHAT_PROMPT_V2],
  [CHAT_PROMPT_V3.version, CHAT_PROMPT_V3],
]);

/** Bütün sürümler (testler: her sürümün araçları kayıt defterinde olmalı). */
export const ALL_CHAT_PROMPTS: readonly ChatPrompt[] = [...CHAT_PROMPTS.values()];

/** Bu sürüm tanımlı mı (ortam değişkeni ve değerlendirme seçeneği doğrulaması). */
export function hasChatPrompt(version: string): boolean {
  return CHAT_PROMPTS.has(version);
}

/** Sürümü verilen prompt; sürüm bilinmiyorsa (ör. hiç model çağrısı olmamış sohbet) güncel sürüm. */
export function chatPrompt(version?: string | null): ChatPrompt {
  return (version ? CHAT_PROMPTS.get(version) : undefined) ?? CURRENT_CHAT_PROMPT;
}
