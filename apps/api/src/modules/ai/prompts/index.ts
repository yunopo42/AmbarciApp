import { CHAT_PROMPT_V1 } from './chat.v1.js';
import { CHAT_PROMPT_V2 } from './chat.v2.js';

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
}

/** Yeni sohbetlerde kullanılan sürüm. */
export const CURRENT_CHAT_PROMPT: ChatPrompt = CHAT_PROMPT_V2;

// Eski sürümler silinmez: süren bir sohbet başladığı sürümle (metni ve araçlarıyla) devam edebilmeli. Sohbetin
// ortasında sistem promptu değişirse geri gönderilen düşünme blokları geçersiz olur (ADR-001).
const CHAT_PROMPTS: ReadonlyMap<string, ChatPrompt> = new Map([
  [CHAT_PROMPT_V1.version, CHAT_PROMPT_V1],
  [CHAT_PROMPT_V2.version, CHAT_PROMPT_V2],
]);

/** Bütün sürümler (testler: her sürümün araçları kayıt defterinde olmalı). */
export const ALL_CHAT_PROMPTS: readonly ChatPrompt[] = [...CHAT_PROMPTS.values()];

/** Sürümü verilen prompt; sürüm bilinmiyorsa (ör. hiç model çağrısı olmamış sohbet) güncel sürüm. */
export function chatPrompt(version?: string | null): ChatPrompt {
  return (version ? CHAT_PROMPTS.get(version) : undefined) ?? CURRENT_CHAT_PROMPT;
}
