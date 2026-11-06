// Sohbetin veritabanı gerektirmeyen kuralları: SSE yazıcısı (olay biçimi, ping, kopmuş bağlantı), ekranda gösterilen
// mesajlar, kayıtlı cevabın bulunması ve sohbet başlığı.
import { randomUUID } from 'node:crypto';

import { chatStreamEventSchema, sendMessageSchema } from '@ambarci/shared';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredMessage } from '../src/modules/assistant/conversations.repository.js';
import { answerTo, titleFrom, toChatMessages } from '../src/modules/assistant/conversations.service.js';
import { SseStream } from '../src/modules/assistant/sse-stream.js';

/** Express yanıtının SSE yazıcısının kullandığı kısmı. */
class FakeResponse {
  statusCode = 0;
  headers = new Map<string, string>();
  chunks: string[] = [];
  flushed = false;
  writableEnded = false;
  destroyed = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
  flushHeaders(): void {
    this.flushed = true;
  }
  on(): this {
    return this;
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end(): void {
    this.writableEnded = true;
  }
}

function stream(pingMs = 15_000): { sse: SseStream; response: FakeResponse } {
  const response = new FakeResponse();
  return { sse: new SseStream(response as unknown as Response, pingMs), response };
}

describe('SSE yazıcısı', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('başlıkları hemen gönderir; her olay "event" ve JSON "data" satırı, ardından boş satır', () => {
    const { sse, response } = stream();
    sse.open();
    const messageId = randomUUID();
    sse.send({ type: 'message_started', messageId, clientMessageId: messageId });
    sse.send({ type: 'text_delta', text: 'Merkez’de 1.400 metre var.' });
    sse.close();

    expect(response.statusCode).toBe(200);
    expect(response.flushed).toBe(true);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.chunks[1]).toBe('event: text_delta\ndata: {"type":"text_delta","text":"Merkez’de 1.400 metre var."}\n\n');
    for (const chunk of response.chunks) {
      const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6) ?? '';
      expect(chatStreamEventSchema.safeParse(JSON.parse(data)).success).toBe(true);
    }
    expect(response.writableEnded).toBe(true);
  });

  it('akış sürerken aralıklarla ": ping" yorum satırı gönderir; kapanınca durur', () => {
    const { sse, response } = stream(15_000);
    sse.open();
    vi.advanceTimersByTime(31_000);
    expect(response.chunks).toEqual([': ping\n\n', ': ping\n\n']);
    sse.close();
    vi.advanceTimersByTime(60_000);
    expect(response.chunks).toHaveLength(2);
  });

  it('istemci bağlantıyı kapattıysa yazmaz ve hata vermez', () => {
    const { sse, response } = stream();
    sse.open();
    response.destroyed = true;
    sse.send({ type: 'text_delta', text: 'kimse okumuyor' });
    vi.advanceTimersByTime(20_000);
    sse.close();
    expect(response.chunks).toEqual([]);
  });
});

function stored(position: number, role: StoredMessage['role'], content: StoredMessage['content'], extra: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: randomUUID(),
    position,
    role,
    content,
    clientMessageId: role === 'USER' ? randomUUID() : null,
    status: role === 'USER' ? 'COMPLETED' : null,
    createdAt: new Date(Date.UTC(2026, 10, 7, 9, position)).toISOString(),
    ...extra,
  };
}

// İki cevaplı sohbet: ilkinde bir araç turu (araç çağrısı + sonuç) ve son cevap, ikincisi başarısız.
const CONVERSATION: StoredMessage[] = [
  stored(1, 'USER', [{ type: 'text', text: 'Merkezde NYM 3x2,5 kaç metre?' }]),
  stored(2, 'ASSISTANT', [
    { type: 'thinking', thinking: '', signature: 'imza' },
    { type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'nym 3x2,5' } },
  ]),
  stored(3, 'TOOL', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }]),
  stored(4, 'ASSISTANT', [{ type: 'thinking', thinking: '', signature: 'imza' }, { type: 'text', text: '1.400 metre var.' }]),
  stored(5, 'USER', [{ type: 'text', text: 'Ostim?' }], { status: 'FAILED' }),
];

describe('Ekrandaki mesajlar ve kayıtlı cevap', () => {
  it('araç sonuçları, yalnızca araç çağıran model mesajı ve düşünme blokları gösterilmez', () => {
    expect(toChatMessages(CONVERSATION).map(({ role, text, status }) => ({ role, text, status }))).toEqual([
      { role: 'user', text: 'Merkezde NYM 3x2,5 kaç metre?', status: 'COMPLETED' },
      { role: 'assistant', text: '1.400 metre var.', status: null },
      { role: 'user', text: 'Ostim?', status: 'FAILED' },
    ]);
  });

  it('kullanıcı mesajının kayıtlı cevabı, sıradaki kullanıcı mesajından önceki son asistan metnidir', () => {
    expect(answerTo(CONVERSATION, CONVERSATION[0] as StoredMessage)).toBe('1.400 metre var.');
    expect(answerTo(CONVERSATION, CONVERSATION[4] as StoredMessage)).toBe('');
  });

  it('sohbet başlığı ilk mesajdan: boşluklar sadeleşir, uzun metin kısaltılır', () => {
    expect(titleFrom('  Merkez   depoda\npriz  ')).toBe('Merkez depoda priz');
    const long = titleFrom('a'.repeat(120));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('mesaj şeması: istemci kimliği UUID, metin kırpılır ve boş olamaz', () => {
    expect(sendMessageSchema.safeParse({ clientMessageId: 'abc', text: 'priz' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ clientMessageId: randomUUID(), text: '   ' }).success).toBe(false);
    expect(sendMessageSchema.parse({ clientMessageId: randomUUID(), text: '  priz  ' }).text).toBe('priz');
  });
});
