import type { ChatStreamEvent } from '@ambarci/shared';
import { describe, expect, it } from 'vitest';

import {
  ApiRequestError,
  createApiClient,
  describeApiError,
  readServerSentEvents,
  STREAM_INTERRUPTED,
  streamChatMessage,
} from '../src/index.js';
import type { ServerSentEvent } from '../src/index.js';

// Sohbet akışının okunması: SSE satırları, parçalı gelen ağ verisi, son olay, akış açılmadan gelen hata ve kopan
// bağlantı. Ağ yerine sahte fetch ve elle kurulan akış kullanılır.

const ORGANIZATION = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e01';
const CONVERSATION = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e02';
const CLIENT_MESSAGE = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e03';
const MESSAGE = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e04';

const encoder = new TextEncoder();

/** Verilen bayt parçalarını sırayla veren akış; `failAfter` verilirse o kadar parçadan sonra hata verir. */
function byteStream(chunks: Uint8Array[], failAfter?: number): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && index === failAfter) {
        controller.error(new TypeError('network connection lost'));
        return;
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
}

function textStream(chunks: string[], failAfter?: number): ReadableStream<Uint8Array> {
  return byteStream(
    chunks.map((chunk) => encoder.encode(chunk)),
    failAfter,
  );
}

function sse(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function collect(body: ReadableStream<Uint8Array>): Promise<ServerSentEvent[]> {
  const events: ServerSentEvent[] = [];
  await readServerSentEvents(body, (event) => events.push(event));
  return events;
}

describe('SSE okuyucu', () => {
  it('olayları ayırır; ping yorumunu atlar, birden fazla data satırını birleştirir, \\r\\n satır sonunu kabul eder', async () => {
    const events = await collect(
      textStream([': ping\n\n', 'event: text_delta\ndata: {"a":1}\n\n', 'data: birinci\r\ndata: ikinci\r\n\r\n', 'event: bos\n\n']),
    );
    expect(events).toEqual([
      { event: 'text_delta', data: '{"a":1}' },
      { event: 'message', data: 'birinci\nikinci' },
    ]);
  });

  it('satırın ve çok baytlı bir harfin ortasında bölünen parçaları doğru birleştirir', async () => {
    const whole = encoder.encode('event: text_delta\ndata: Merkez’de 1.412,5 metre; şöyle\n\n');
    // ’ (3 bayt) ve ş (2 bayt) parçaların sınırına denk gelecek biçimde bayt bayt bölünür.
    const chunks = Array.from(whole, (byte) => new Uint8Array([byte]));
    expect(await collect(byteStream(chunks))).toEqual([{ event: 'text_delta', data: 'Merkez’de 1.412,5 metre; şöyle' }]);
  });

  it('boş satırla bitmeyen son olayı atar', async () => {
    expect(await collect(textStream(['event: done\ndata: {"yarim":true}']))).toEqual([]);
  });
});

function clientWith(fetch: (request: Request) => Promise<Response>): ReturnType<typeof createApiClient> {
  return createApiClient({ baseUrl: 'https://api.test', getAccessToken: async () => 'token-1', organizationId: ORGANIZATION, fetch });
}

function streamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

const started: ChatStreamEvent = { type: 'message_started', messageId: MESSAGE, clientMessageId: CLIENT_MESSAGE };
const done: ChatStreamEvent = { type: 'done', messageId: MESSAGE, text: 'Merkez Depo’da 1.400 metre var.', replayed: false };

describe('Sohbet akışı', () => {
  it('mesajı oturum başlıklarıyla gönderir, olayları sırasıyla verir ve son olayı döner', async () => {
    const requests: Request[] = [];
    const client = clientWith(async (request) => {
      requests.push(request);
      return streamResponse(
        textStream([
          sse(started),
          sse({ type: 'tool_status', tool: 'search_products', label: 'Ürün aranıyor', status: 'started' }),
          ': ping\n\n',
          'event: yeni_bir_olay\ndata: {"type":"yeni_bir_olay"}\n\n',
          'event: bozuk\ndata: {bozuk json\n\n',
          sse({ type: 'text_delta', text: 'Merkez Depo’da ' }),
          sse({ type: 'text_delta', text: '1.400 metre var.' }),
          sse(done),
        ]),
      );
    });

    const events: ChatStreamEvent[] = [];
    const end = await streamChatMessage(client, {
      conversationId: CONVERSATION,
      message: { clientMessageId: CLIENT_MESSAGE, text: 'Merkezde NYM kaç metre?' },
      onEvent: (event) => events.push(event),
    });

    expect(end).toEqual(done);
    expect(events.map((event) => event.type)).toEqual(['message_started', 'tool_status', 'text_delta', 'text_delta', 'done']);
    const request = requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(`https://api.test/v1/conversations/${CONVERSATION}/messages`);
    expect(request?.headers.get('authorization')).toBe('Bearer token-1');
    expect(request?.headers.get('x-organization-id')).toBe(ORGANIZATION);
    expect(request?.headers.get('accept')).toBe('text/event-stream');
    expect(await request?.json()).toEqual({ clientMessageId: CLIENT_MESSAGE, text: 'Merkezde NYM kaç metre?' });
  });

  it('cevap üretilemezse son olay error olur', async () => {
    const failed: ChatStreamEvent = { type: 'error', code: 'AI_UNAVAILABLE', message: 'Asistan şu an cevap veremiyor.' };
    const client = clientWith(async () => streamResponse(textStream([sse(started), sse(failed)])));
    const end = await streamChatMessage(client, {
      conversationId: CONVERSATION,
      message: { clientMessageId: CLIENT_MESSAGE, text: 'priz' },
      onEvent: () => undefined,
    });
    expect(end).toEqual(failed);
  });

  it('akış açılmadan gelen hata (409) API kodu, mesajı ve durum koduyla fırlatılır', async () => {
    const client = clientWith(
      async () =>
        new Response(JSON.stringify({ error: { code: 'MESSAGE_IN_PROGRESS', message: 'Bu mesajın cevabı hâlâ hazırlanıyor.' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const failure = await streamChatMessage(client, {
      conversationId: CONVERSATION,
      message: { clientMessageId: CLIENT_MESSAGE, text: 'priz' },
      onEvent: () => undefined,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).status).toBe(409);
    expect(describeApiError(failure)).toEqual({ code: 'MESSAGE_IN_PROGRESS', message: 'Bu mesajın cevabı hâlâ hazırlanıyor.' });
  });

  it('son olay gelmeden biten ya da kopan akış STREAM_INTERRUPTED verir', async () => {
    for (const body of [textStream([sse(started), sse({ type: 'text_delta', text: 'Merkez' })]), textStream([sse(started)], 1)]) {
      const events: ChatStreamEvent[] = [];
      const failure = await streamChatMessage(clientWith(async () => streamResponse(body)), {
        conversationId: CONVERSATION,
        message: { clientMessageId: CLIENT_MESSAGE, text: 'priz' },
        onEvent: (event) => events.push(event),
      }).catch((error: unknown) => error);

      expect(describeApiError(failure).code).toBe(STREAM_INTERRUPTED);
      expect(events[0]).toEqual(started);
    }
  });

  it('son olaydan sonra kopan bağlantı cevabı bozmaz', async () => {
    const client = clientWith(async () => streamResponse(textStream([sse(started), sse(done)], 2)));
    const end = await streamChatMessage(client, {
      conversationId: CONVERSATION,
      message: { clientMessageId: CLIENT_MESSAGE, text: 'priz' },
      onEvent: () => undefined,
    });
    expect(end).toEqual(done);
  });
});
