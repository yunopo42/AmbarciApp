import { CHAT_PROMPT_V1 } from './chat.v1.js';

/** Sürümlü sistem promptu. Sürüm, ai_runs.prompt_version'a yazılır; sonuçlar sürüme göre kıyaslanır. */
export interface ChatPrompt {
  version: string;
  text: string;
}

/** Yeni sohbetlerde kullanılan sürüm. */
export const CURRENT_CHAT_PROMPT: ChatPrompt = CHAT_PROMPT_V1;

// Eski sürümler silinmez: süren bir sohbet başladığı sürümle devam edebilmeli. Sohbetin ortasında sistem promptu
// değişirse geri gönderilen düşünme blokları geçersiz olur (ADR-001).
const CHAT_PROMPTS: ReadonlyMap<string, ChatPrompt> = new Map([[CHAT_PROMPT_V1.version, CHAT_PROMPT_V1]]);

/** Sürümü verilen prompt; sürüm bilinmiyorsa (ör. hiç model çağrısı olmamış sohbet) güncel sürüm. */
export function chatPrompt(version?: string | null): ChatPrompt {
  return (version ? CHAT_PROMPTS.get(version) : undefined) ?? CURRENT_CHAT_PROMPT;
}
