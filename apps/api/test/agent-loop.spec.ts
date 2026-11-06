// Ajan döngüsü, veritabanı ve gerçek model olmadan: sahte sağlayıcı sıraya konan cevapları döner, okuma araçları
// sahte servislerle çalışır. Turların sırası, paralel araç çağrıları, geçmişin değiştirilmeden büyümesi, tur sınırı,
// bütçe ve modelin hatalı girdisi denetlenir.
import { randomUUID } from 'node:crypto';

import type { MessageContentBlock } from '@ambarci/db';
import { describe, expect, it } from 'vitest';

import { ApiException } from '../src/common/api-exception.js';
import type { AiToolCall } from '../src/modules/ai/ai-provider.js';
import { CHAT_PROMPT_V1 } from '../src/modules/ai/prompts/chat.v1.js';
import { AgentLoop, MAX_TOOL_ROUNDS } from '../src/modules/assistant/agent-loop.js';
import type { AgentEvent, AgentMessage, AgentTurnInput } from '../src/modules/assistant/agent-loop.js';
import { createReadTools } from '../src/modules/assistant/tools/read-tools.js';
import { ToolRegistry } from '../src/modules/assistant/tools/registry.js';
import { adminContext, fakeReadServices, InMemoryAiRuns, MAIN, PRODUCT, testAiService } from './support/assistant-fakes.js';
import { aiResult, ScriptedAiProvider } from './support/scripted-ai-provider.js';

const USER_MESSAGE: AgentMessage = { role: 'USER', content: [{ type: 'text', text: 'Merkez depoda NYM 3x2,5 kablodan kaç metre var?' }] };

/** Modelin araç isteyen cevabı: imzalı düşünme bloğu ve araç çağrıları. */
function toolTurn(calls: AiToolCall[], signature = 'imza'): ReturnType<typeof aiResult> {
  const content: MessageContentBlock[] = [
    { type: 'thinking', thinking: '', signature },
    ...calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
  ];
  return aiResult({ content, toolCalls: calls, stopReason: 'tool_use', text: '' });
}

function setup(): {
  loop: AgentLoop;
  provider: ScriptedAiProvider;
  runs: InMemoryAiRuns;
  calls: ReturnType<typeof fakeReadServices>['calls'];
} {
  const provider = new ScriptedAiProvider();
  const runs = new InMemoryAiRuns();
  const { services, calls } = fakeReadServices();
  const loop = new AgentLoop(testAiService(provider, runs), new ToolRegistry(createReadTools(services)));
  return { loop, provider, runs, calls };
}

function turnInput(overrides: Partial<AgentTurnInput> = {}): AgentTurnInput {
  return { context: adminContext, messageId: randomUUID(), history: [USER_MESSAGE], ...overrides };
}

async function apiErrorCode(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiException);
  return (error as ApiException).code;
}

describe('Ajan döngüsü', () => {
  it('araç turlarını yürütür: paralel çağrılar tek mesajda, geçmiş değiştirilmeden büyür, son cevap metin', async () => {
    const { loop, provider, runs } = setup();
    provider.push(
      toolTurn(
        [
          { id: 'toolu_1', name: 'search_products', input: { query: 'NYM kablo 3x2,5' } },
          { id: 'toolu_2', name: 'list_warehouses', input: {} },
        ],
        'imza-1',
      ),
      toolTurn([{ id: 'toolu_3', name: 'get_stock', input: { product_id: PRODUCT, warehouse_id: MAIN } }], 'imza-2'),
      aiResult({ text: 'Merkez Depo’da NYM kablo 3x2,5 mm² (KBL-NYM-25) için 1.412,5 metre var.' }),
    );
    const events: AgentEvent[] = [];
    const rounds: AgentMessage[][] = [];
    const input = turnInput({ onEvent: (event) => events.push(event), onRound: async (messages) => void rounds.push(messages) });

    const output = await loop.run(input);

    expect(output.toolRounds).toBe(2);
    expect(output.text).toMatch(/1\.412,5 metre/);
    expect(output.promptVersion).toBe('chat-v1');
    expect(output.messages.map((message) => message.role)).toEqual(['ASSISTANT', 'TOOL', 'ASSISTANT', 'TOOL', 'ASSISTANT']);
    // Her tur bitince: araç çağrısı sonucuyla birlikte, son cevap tek başına.
    expect(rounds.map((round) => round.map((message) => message.role))).toEqual([['ASSISTANT', 'TOOL'], ['ASSISTANT', 'TOOL'], ['ASSISTANT']]);

    // Aynı turdaki iki çağrının sonucu çağrı sırasıyla tek mesajda.
    const firstResults = output.messages[1]?.content ?? [];
    expect(firstResults.map((block) => block.tool_use_id)).toEqual(['toolu_1', 'toolu_2']);
    expect(firstResults.every((block) => block.type === 'tool_result' && block.is_error === undefined)).toBe(true);

    // Model her turda sabit sistem promptunu ve aynı araç listesini aldı; geçmiş yalnızca sona eklenerek büyüdü.
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests.every((request) => request.system === CHAT_PROMPT_V1.text)).toBe(true);
    expect(provider.requests[2]?.tools.map((tool) => tool.name)).toEqual(['search_products', 'list_warehouses', 'get_stock', 'list_recent_movements']);
    const lastHistory = provider.requests[2]?.messages ?? [];
    expect(lastHistory.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(lastHistory[1]?.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'imza-1' });
    expect(lastHistory.slice(0, 3)).toEqual(provider.requests[1]?.messages);

    // Araç durumu ve metin parçaları istemciye aktarıldı.
    expect(events.filter((event) => event.type === 'tool_status')).toEqual([
      { type: 'tool_status', tool: 'search_products', label: 'Ürün aranıyor', status: 'started' },
      { type: 'tool_status', tool: 'list_warehouses', label: 'Depolar getiriliyor', status: 'started' },
      { type: 'tool_status', tool: 'search_products', label: 'Ürün aranıyor', status: 'succeeded' },
      { type: 'tool_status', tool: 'list_warehouses', label: 'Depolar getiriliyor', status: 'succeeded' },
      { type: 'tool_status', tool: 'get_stock', label: 'Stok sorgulanıyor', status: 'started' },
      { type: 'tool_status', tool: 'get_stock', label: 'Stok sorgulanıyor', status: 'succeeded' },
    ]);
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.text).join('')).toBe(output.text);

    // Her model çağrısı aynı kullanıcı mesajına bağlı, tur numarasıyla kaydedildi.
    expect(runs.entries.map((entry) => [entry.roundNo, entry.messageId, entry.errorCode])).toEqual([
      [1, input.messageId, null],
      [2, input.messageId, null],
      [3, input.messageId, null],
    ]);
    expect(runs.entries[0]?.toolCalls).toEqual(['search_products', 'list_warehouses']);
  });

  it(`${MAX_TOOL_ROUNDS} araç turundan sonra model hâlâ araç isterse durur: AGENT_TOOL_LIMIT, ai_runs'ta işaretli`, async () => {
    const { loop, provider, runs } = setup();
    for (let round = 1; round <= MAX_TOOL_ROUNDS + 1; round++) {
      provider.push(toolTurn([{ id: `toolu_${round}`, name: 'list_warehouses', input: {} }]));
    }
    const rounds: AgentMessage[][] = [];

    expect(await apiErrorCode(loop.run(turnInput({ onRound: async (messages) => void rounds.push(messages) })))).toBe('AGENT_TOOL_LIMIT');

    expect(provider.requests).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(rounds).toHaveLength(MAX_TOOL_ROUNDS);
    expect(runs.entries.map((entry) => entry.errorCode)).toEqual([null, null, null, null, null, 'AGENT_TOOL_LIMIT']);
  });

  it('günlük bütçe dolmuşsa model hiç çağrılmaz', async () => {
    const { loop, provider, runs } = setup();
    runs.usage = { user: 600_000, organization: 600_000 };
    expect(await apiErrorCode(loop.run(turnInput()))).toBe('AI_BUDGET_EXCEEDED');
    expect(provider.requests).toHaveLength(0);
  });

  it('modelin hatalı araç girdisi çalıştırılmaz; hata modele döner ve konuşma sürer', async () => {
    const { loop, provider, calls } = setup();
    provider.push(
      toolTurn([{ id: 'toolu_1', name: 'get_stock', input: { product_id: 'KBL-NYM-25', organization_id: randomUUID() } }]),
      aiResult({ text: 'Ürünü önce aramam gerekiyor; hangi kabloyu soruyorsunuz?' }),
    );
    const output = await loop.run(turnInput());

    const [result] = output.messages[1]?.content ?? [];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true });
    expect(String(result?.content)).toMatch(/Girdi geçersiz/);
    expect(calls.productStock).toBe(0);
    expect(output.messages).toHaveLength(3);
  });

  it('modelin hatası (red) yukarı çıkar; önceki turun mesajları yazılmış olarak kalır', async () => {
    const { loop, provider } = setup();
    provider.push(toolTurn([{ id: 'toolu_1', name: 'list_warehouses', input: {} }]), aiResult({ stopReason: 'refusal', text: '' }));
    const rounds: AgentMessage[][] = [];
    expect(await apiErrorCode(loop.run(turnInput({ onRound: async (messages) => void rounds.push(messages) })))).toBe('AI_REFUSED');
    expect(rounds).toHaveLength(1);
  });

  it('süren sohbet başladığı prompt sürümüyle devam eder; bilinmeyen sürümde güncel sürüm', async () => {
    const { loop, provider } = setup();
    provider.push(aiResult(), aiResult());
    expect((await loop.run(turnInput({ promptVersion: 'chat-v1' }))).promptVersion).toBe('chat-v1');
    expect((await loop.run(turnInput({ promptVersion: 'chat-v0' }))).promptVersion).toBe('chat-v1');
  });

  it('saklanan TOOL mesajı API\'ye "user" rolüyle gider', async () => {
    const { loop, provider } = setup();
    provider.push(aiResult());
    const history: AgentMessage[] = [
      USER_MESSAGE,
      { role: 'ASSISTANT', content: [{ type: 'tool_use', id: 'toolu_0', name: 'list_warehouses', input: {} }] },
      { role: 'TOOL', content: [{ type: 'tool_result', tool_use_id: 'toolu_0', content: '{}' }] },
      { role: 'ASSISTANT', content: [{ type: 'text', text: 'İki depo var.' }] },
      { role: 'USER', content: [{ type: 'text', text: 'Araçta ne var?' }] },
    ];
    await loop.run(turnInput({ history }));
    expect(provider.requests[0]?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(provider.requests[0]?.messages.map((message) => message.content)).toEqual(history.map((message) => message.content));
  });
});
