// Claude adaptörü, ağ olmadan: SDK'ya sahte bir fetch verilir. Böylece SDK'nın gerçekten gönderdiği istek gövdesi
// denetlenir (ADR-001 kuralları) ve hazır bir akış (SSE) cevabının sonuca nasıl çevrildiği görülür.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHAT_MAX_TOKENS, ClaudeAdapter, describeErrorCause } from '../src/modules/ai/adapters/claude.adapter.js';
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

async function providerError(promise: Promise<unknown>): Promise<AiProviderError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AiProviderError);
  return error as AiProviderError;
}

async function providerErrorCode(promise: Promise<unknown>): Promise<AiProviderErrorCode> {
  return (await providerError(promise)).code;
}

/** Node'un fetch'inin bağlantı reddinde fırlattığı hatanın biçimi: "fetch failed", asıl neden `cause`'ta. */
function connectionRefused(address = '127.0.0.1:1337'): TypeError {
  const cause = Object.assign(new Error(`connect ECONNREFUSED ${address}`), { code: 'ECONNREFUSED' });
  return new TypeError('fetch failed', { cause });
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

describe('Claude adaptörü: adres ve hata kaydı (#72)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ANTHROPIC_BASE_URL başka bir adrese ayarlıyken de istek api.anthropic.com adresine gider', async () => {
    // 4. haftada geliştirici bilgisayarında bu değişken tanımlıydı; SDK istekleri boş bir porta gönderiyordu.
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://127.0.0.1:1337');
    const { fetch, requests } = recordingFetch(() => sse(STREAM));
    await adapter(fetch).createTurn(turnRequest());

    expect(requests.map((request) => request.url)).toEqual(['https://api.anthropic.com/v1/messages']);
  });

  it('test kendi adresini verebilir (options.client sabit adresten sonra gelir)', async () => {
    const { fetch, requests } = recordingFetch(() => sse(STREAM));
    const custom = new ClaudeAdapter({
      apiKey: 'test-anahtar',
      model: 'claude-haiku-5-5',
      effort: 'low',
      client: { fetch, maxRetries: 0, baseURL: 'http://claude.test' },
    });
    await custom.createTurn(turnRequest());

    expect(requests.map((request) => request.url)).toEqual(['http://claude.test/v1/messages']);
  });

  it('bağlantı hatasında hata mesajı hedef sunucuyu ve alttaki nedeni söyler', async () => {
    const failing: FakeFetch = async () => {
      throw connectionRefused();
    };
    const error = await providerError(adapter(failing).createTurn(turnRequest()));

    expect(error.code).toBe('AI_UNAVAILABLE');
    expect(error.message).toContain('api.anthropic.com');
    expect(error.message).toContain('ECONNREFUSED 127.0.0.1:1337');
  });

  it('hata mesajına API anahtarı ve mesaj içeriği girmez', async () => {
    // Anahtar normalde hata metninde geçmez; geçse bile loga gitmeden silinir.
    const failing: FakeFetch = async () => {
      throw new TypeError('fetch failed', { cause: new Error('beklenmeyen: Bearer test-anahtar') });
    };
    const error = await providerError(adapter(failing).createTurn(turnRequest()));

    expect(error.code).toBe('AI_UNAVAILABLE');
    expect(error.message).not.toContain('test-anahtar');
    expect(error.message).toContain('[anahtar gizlendi]');
    const userText = (HISTORY[0]?.content[0] as { text: string }).text;
    expect(error.message).not.toContain(userText);
    expect(error.message).not.toContain('Sen saha stok asistanısın.');
  });

  it('describeErrorCause: zinciri sırayla birleştirir, kodu bir kez yazar, döngüde durur', () => {
    expect(describeErrorCause(new Error('dış'))).toBe('');
    expect(describeErrorCause(new Error('Connection error.', { cause: connectionRefused('10.0.0.1:443') }))).toBe(
      'fetch failed ← connect ECONNREFUSED 10.0.0.1:443',
    );
    const withCode = new Error('dış', { cause: Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' }) });
    expect(describeErrorCause(withCode)).toBe('getaddrinfo failed (ENOTFOUND)');
    expect(describeErrorCause(new Error('dış', { cause: 'düz metin neden' }))).toBe('düz metin neden');

    const loop = new Error('a');
    loop.cause = loop;
    expect(describeErrorCause(new Error('dış', { cause: loop })).split(' ← ')).toHaveLength(4);
  });
});
