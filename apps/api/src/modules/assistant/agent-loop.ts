import type { MessageContentBlock } from '@ambarci/db';
import { Inject, Injectable } from '@nestjs/common';

import type { AiMessage, AiToolCall } from '../ai/ai-provider.js';
import { AiService } from '../ai/ai.service.js';
import { chatPrompt } from '../ai/prompts/index.js';
import { ToolRegistry } from './tools/registry.js';
import type { ToolContext } from './tools/registry.js';

/** Mesaj başına en fazla araç turu (mimari değişmez 10). Son cevapla birlikte en fazla 6 model çağrısı. */
export const MAX_TOOL_ROUNDS = 5;

/** messages tablosundaki rolüyle bir mesaj: USER (kullanıcı), ASSISTANT (model), TOOL (araç sonuçları). */
export interface AgentMessage {
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: MessageContentBlock[];
}

/** Cevap sürerken istemciye aktarılan olaylar (SSE, #57). */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_status'; tool: string; label: string; status: 'started' | 'succeeded' | 'failed' };

export interface AgentTurnInput {
  /** Şirket, rol ve kullanıcı: oturumdan. */
  context: ToolContext;
  /** Cevaplanan kullanıcı mesajı (ai_runs bu mesaja bağlanır). */
  messageId: string;
  /** Sohbetin başladığı prompt sürümü; yeni sohbette boş (güncel sürüm). */
  promptVersion?: string | null;
  /** Sohbetin geçmişi, yeni kullanıcı mesajıyla biter. */
  history: AgentMessage[];
  onEvent?: (event: AgentEvent) => void;
  /**
   * Her tur bitince yeni mesajlarla çağrılır: araç turunda [ASSISTANT, TOOL], son turda [ASSISTANT]. Araç çağrısı
   * ve sonucu birlikte gelir: biri yazılıp öteki yazılmadan kesilirse (çökme) geçmiş bozulurdu, çünkü API her
   * tool_use bloğunun hemen ardından sonucunu ister.
   */
  onRound?: (messages: AgentMessage[]) => Promise<void>;
  signal?: AbortSignal;
}

export interface AgentTurnOutput {
  /** Geçmişe eklenen mesajlar, sırasıyla. */
  messages: AgentMessage[];
  /** Son cevabın metni. */
  text: string;
  toolRounds: number;
  promptVersion: string;
}

/**
 * Ajan döngüsü: modeli çağırır; model araç isterse araçları kullanıcının yetkisiyle çalıştırır, sonuçları geri verir ve
 * model metinle cevaplayana kadar tekrarlar. Döngü stoğa yazmaz: kayıt defterinde stok yazan ya da onaylayan araç
 * yoktur; öneri araçları işlemi yalnızca onay bekleyen olarak açar (mimari değişmez 1 ve 2). Mesajları kendisi
 * kaydetmez; onRound ile çağırana bırakır (#57).
 */
@Injectable()
export class AgentLoop {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(ToolRegistry) private readonly tools: ToolRegistry,
  ) {}

  async run(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const { onEvent } = input;
    // Araçlar cevaplanan mesajı bilir: öneri araçları açtıkları işlemi bu mesaja bağlar (#74).
    const context: ToolContext = { ...input.context, messageId: input.messageId };
    const organizationId = context.organization.id;
    // Bütçe her kullanıcı mesajının başında bir kez denetlenir, araç turlarının ortasında değil (#55).
    await this.ai.assertWithinBudget(organizationId, context.userId);

    // Sohbet başladığı sürümün metni ve araçlarıyla sürer: chat-v1 sohbetine öneri aracı verilmez (#74).
    const prompt = chatPrompt(input.promptVersion);
    const tools = this.tools.definitions(prompt.tools);
    const conversation: AiMessage[] = input.history.map(toAiMessage);
    const added: AgentMessage[] = [];

    for (let round = 1; ; round++) {
      const result = await this.ai.createTurn(
        {
          organizationId,
          userId: context.userId,
          messageId: input.messageId,
          roundNo: round,
          promptVersion: prompt.version,
          lastRound: round > MAX_TOOL_ROUNDS,
        },
        {
          system: prompt.text,
          tools,
          // Kopya: sağlayıcı isteği saklarsa (ör. yeniden deneme) sonraki turların eklemeleri ona yansımasın.
          messages: [...conversation],
          onTextDelta: (text) => onEvent?.({ type: 'text_delta', text }),
          signal: input.signal,
        },
      );

      const assistant: AgentMessage = { role: 'ASSISTANT', content: result.content };
      conversation.push({ role: 'assistant', content: result.content });

      if (result.toolCalls.length === 0) {
        added.push(assistant);
        await input.onRound?.([assistant]);
        return { messages: added, text: result.text, toolRounds: round - 1, promptVersion: prompt.version };
      }

      // Aynı turdaki araç çağrıları birlikte çalışır; sonuçlar çağrı sırasıyla tek bir mesajda döner (API bunu ister;
      // sonuçları ayrı mesajlara bölmek modelin paralel çağrı yapmasını da azaltır).
      const results = await Promise.all(result.toolCalls.map((call) => this.runTool(call, context, prompt.tools, onEvent)));
      const toolMessage: AgentMessage = { role: 'TOOL', content: results };
      conversation.push({ role: 'user', content: results });
      added.push(assistant, toolMessage);
      await input.onRound?.([assistant, toolMessage]);
    }
  }

  private async runTool(
    call: AiToolCall,
    context: ToolContext,
    allowed: readonly string[],
    onEvent: AgentTurnInput['onEvent'],
  ): Promise<MessageContentBlock> {
    const label = this.tools.statusLabel(call.name);
    onEvent?.({ type: 'tool_status', tool: call.name, label, status: 'started' });
    const outcome = await this.tools.execute(call.name, call.input, context, allowed);
    onEvent?.({ type: 'tool_status', tool: call.name, label, status: outcome.isError ? 'failed' : 'succeeded' });
    return {
      type: 'tool_result',
      tool_use_id: call.id,
      content: outcome.content,
      ...(outcome.isError ? { is_error: true } : {}),
    };
  }
}

/** Saklanan rol API rolüne çevrilir: araç sonuçları API'ye "user" rolüyle gider. İçerik değişmez. */
export function toAiMessage(message: AgentMessage): AiMessage {
  return { role: message.role === 'ASSISTANT' ? 'assistant' : 'user', content: message.content };
}
