// Claude adaptörü, ağ olmadan: SDK'ya sahte bir fetch verilir. Böylece SDK'nın gerçekten gönderdiği istek gövdesi
// denetlenir (ADR-001 kuralları) ve hazır bir akış (SSE) cevabının sonuca nasıl çevrildiği görülür.
import { describe, expect, it } from 'vitest';

import { CHAT_MAX_TOKENS, ClaudeAdapter } from '../src/modules/ai/adapters/claude.adapter.js';
import { AiProviderError } from '../src/modules/ai/ai-provider.js';
import type { AiMessage, AiProviderErrorCode, AiToolDefinition, AiTurnRequest } from '../src/modules/ai/ai-provider.js';

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type FakeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function adapter(fetch: FakeFetch, apiKey: string | null = 'test-anahtar'): ClaudeAdapter {
  return new ClaudeAdapter({ apiKey, model: 'claude-haiku-5-5', effort: 'low', client: { fetch, maxRetries: 0 } });
}

/** İsteği kaydeden ve verilen cevabı dönen sahte fetch. */
function recordingFetch(respond: () => Response): { fetch: FakeFetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetch: FakeFetch = async (input, init) => {
    if (init?.signal?.aborted) {
      throw new DOMException('İstek iptal edildi.', 'AbortError');
    }
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return respond();
  };
  return { fetch, requests };
}

function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function apiError(status: number, type: string): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message: `${type} (test)` } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Modelin cevabı: düşünme bloğu (metni boş, yalnızca imza), iki parça metin ve bir araç çağrısı.
const STREAM = [
  {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 3000 },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'imza-abc' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Bakıyorum, ' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'bir saniye.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_2', name: 'get_stock', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"product_id":"p-1"}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 85 } },
  { type: 'message_stop' },
];

const TOOLS: AiToolDefinition[] = [
  {
    name: 'get_stock',
    description: 'Ürünün depolardaki stoğu.',
    inputSchema: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
      additionalProperties: false,
    },
  },
];

// Önceki tur: kullanıcı mesajı, düşünme bloğu ve araç çağrısı içeren asistan mesajı, araç sonucu.
const HISTORY: AiMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Merkez depoda NYM kablodan kaç metre var?' }] },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: 'imza-onceki' },
      { type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'nym kablo' } },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[{"product_id":"p-1"}]' }] },
];

function turnRequest(overrides: Partial<AiTurnRequest> = {}): AiTurnRequest {
  return { system: 'Sen saha stok asistanısın.', tools: TOOLS, messages: HISTORY, ...overrides };
}

async function providerErrorCode(promise: Promise<unknown>): Promise<AiProviderErrorCode> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return (error as AiProviderError).code;
}

describe('Claude adaptörü', () => {
  it('ADR-001 kurallarına uyan istek gönderir; geçmişi ve düşünme bloklarını değiştirmez', async () => {
    const { fetch, requests } = recordingFetch(() => sse(STREAM));
    await adapter(fetch).createTurn(turnRequest());

    expect(requests).toHaveLength(1);
    const [{ url, headers, body }] = requests as [CapturedRequest];
    expect(url).toMatch(/\/v1\/messages$/);
    // SDK 1.x anahtarı Authorization başlığıyla gönderir; API sürümü 2026-10-21.
    expect(headers.get('authorization')).toBe('Bearer test-anahtar');
    expect(headers.get('anthropic-version')).toBe('2026-10-21');
    for (const removed of ['temperature', 'top_p', 'top_k']) {
      expect(body).not.toHaveProperty(removed);
    }
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: CHAT_MAX_TOKENS,
      stream: true,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      cache_control: { type: 'ephemeral' },
    });
    expect(CHAT_MAX_TOKENS).toBeGreaterThanOrEqual(4096);
    expect(body.system).toEqual([{ type: 'text', text: 'Sen saha stok asistanısın.', cache_control: { type: 'ephemeral' } }]);
    expect(body.tools).toEqual([{ name: 'get_stock', description: 'Ürünün depolardaki stoğu.', input_schema: TOOLS[0]?.inputSchema, strict: true }]);
    // Geçmiş birebir: düşünme bloğunun boş metni ve imzası dahil.
    expect(body.messages).toEqual(HISTORY);
  });

  it('akışı sonuca çevirir: bloklar, metin parçaları, araç çağrısı ve token sayıları', async () => {
    const { fetch } = recordingFetch(() => sse(STREAM));
    const deltas: string[] = [];
    const result = await adapter(fetch).createTurn(turnRequest({ onTextDelta: (text) => deltas.push(text) }));

    expect(deltas).toEqual(['Bakıyorum, ', 'bir saniye.']);
    expect(result.text).toBe('Bakıyorum, bir saniye.');
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toEqual([{ id: 'toolu_2', name: 'get_stock', input: { product_id: 'p-1' } }]);
    // Düşünme bloğu metni boş olsa da atılmaz; imzasıyla saklanır ve sonraki istekte geri gönderilir.
    expect(result.content[0]).toEqual({ type: 'thinking', thinking: '', signature: 'imza-abc' });
    expect(result.content[1]).toMatchObject({ type: 'text', text: 'Bakıyorum, bir saniye.' });
    expect(result.content[2]).toMatchObject({ type: 'tool_use', id: 'toolu_2', name: 'get_stock', input: { product_id: 'p-1' } });
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 85, cacheReadInputTokens: 900, cacheCreationInputTokens: 3000 });
    expect(result).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' });
    expect(result.firstTokenMs).not.toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(result.firstTokenMs ?? 0);
  });

  it('araç yoksa tools alanı gönderilmez', async () => {
    const { fetch, requests } = recordingFetch(() => sse(STREAM));
    await adapter(fetch).createTurn(turnRequest({ tools: [] }));
    expect(requests[0]?.body).not.toHaveProperty('tools');
  });

  it('anahtar tanımlı değilse istek göndermeden AI_NOT_CONFIGURED fırlatır', async () => {
    const { fetch, requests } = recordingFetch(() => sse(STREAM));
    expect(await providerErrorCode(adapter(fetch, null).createTurn(turnRequest()))).toBe('AI_NOT_CONFIGURED');
    expect(requests).toHaveLength(0);
  });

  it.each([
    [429, 'rate_limit_error', 'AI_RATE_LIMITED'],
    [529, 'overloaded_error', 'AI_OVERLOADED'],
    [500, 'api_error', 'AI_UNAVAILABLE'],
    [401, 'authentication_error', 'AI_AUTH_FAILED'],
    [400, 'invalid_request_error', 'AI_REQUEST_REJECTED'],
  ])('HTTP %i (%s) → %s', async (status, type, code) => {
    const { fetch } = recordingFetch(() => apiError(status, type));
    expect(await providerErrorCode(adapter(fetch).createTurn(turnRequest()))).toBe(code);
  });

  it('bağlantı hatası AI_UNAVAILABLE, iptal AI_ABORTED olur', async () => {
    const failing: FakeFetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await providerErrorCode(adapter(failing).createTurn(turnRequest()))).toBe('AI_UNAVAILABLE');

    const controller = new AbortController();
    controller.abort();
    const { fetch } = recordingFetch(() => sse(STREAM));
    expect(await providerErrorCode(adapter(fetch).createTurn(turnRequest({ signal: controller.signal })))).toBe('AI_ABORTED');
  });
});
