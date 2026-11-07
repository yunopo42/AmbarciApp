import { chatStreamEventSchema } from '@ambarci/shared';
import type { ChatStreamEvent, SendMessageInput } from '@ambarci/shared';

import { ApiRequestError, describeApiError } from './errors.js';
import type { ApiClient } from './index.js';

// Sohbet cevabının akışı (SSE, #57): mobil (#58) ve web (#59) aynı okuyucuyu kullanır. İstek tipli istemciden geçer
// (yol, gövde ve oturum başlıkları onunla gelir); yalnızca cevabın gövdesi JSON yerine akış olarak okunur.

/** SSE'nin bir olayı: `event:` satırı (yoksa "message") ve `data:` satırları. */
export interface ServerSentEvent {
  event: string;
  data: string;
}

/**
 * text/event-stream gövdesini olaylara ayırır (WHATWG HTML, "Server-sent events"): satır sonu `\n` ya da `\r\n`; boş
 * satır olayı bitirir; `:` ile başlayan satır yorumdur (sunucunun `: ping` satırı); birden fazla `data:` satırı satır
 * sonuyla birleşir. Ağdan gelen parçalar satırın, hatta bir Türkçe harfin ortasında bölünebilir; metin satır satır
 * birleştirilerek okunur. Okuma bitmeden çıkılırsa (hata ya da iptal) bağlantı kapatılır.
 */
export async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ServerSentEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];

  const takeLine = (line: string): void => {
    if (line === '') {
      if (dataLines.length > 0) {
        onEvent({ event: eventName || 'message', data: dataLines.join('\n') });
      }
      eventName = '';
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // `id` ve `retry` kullanılmıyor: istemci kopan akışı sürdürmez, mesajı aynı kimlikle yeniden gönderir.
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        takeLine(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
      if (done) {
        // Boş satırla bitmemiş son olay yarımdır; standart gereği atılır.
        return;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

/** Akışın son olayı: cevap bitti ya da üretilemedi. */
export type ChatStreamEnd = Extract<ChatStreamEvent, { type: 'done' | 'error' }>;

/** Akış `done` ya da `error` gelmeden koptuğunda verilen kod. */
export const STREAM_INTERRUPTED = 'STREAM_INTERRUPTED';

export interface ChatStreamOptions {
  conversationId: string;
  message: SendMessageInput;
  /** Gelen her olay için, geliş sırasıyla çağrılır (son olay dahil). Hata fırlatmamalı. */
  onEvent: (event: ChatStreamEvent) => void;
  /** İptal edilirse okuma durur. Sunucu cevabı yine tamamlayıp kaydeder (#57). */
  signal?: AbortSignal;
  /**
   * Cevabın gövdesini parça parça verebilen fetch. Tarayıcının fetch'i bunu yapar; mobilde expo/fetch kullanılır.
   * Verilmezse istemcinin fetch'i kullanılır.
   */
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * Mesajı gönderir ve cevabın olaylarını akıtır; son olayı (`done` ya da `error`) döner.
 *
 * - Akış açılmadan verilen kararlar (doğrulama 400, sohbet yok 404, cevap sürüyor 409) JSON hata gövdesiyle gelir:
 *   ApiRequestError fırlatılır, içinde API'nin kodu ve Türkçe mesajı vardır.
 * - Akış `done` ya da `error` gelmeden koparsa STREAM_INTERRUPTED fırlatılır. Cevap sunucuda tamamlanmış olabilir;
 *   mesaj aynı `clientMessageId` ile tekrar gönderilince kaydedilen cevap gelir, model ikinci kez çağrılmaz.
 * - Sunucuya hiç ulaşılamazsa fetch'in hatası olduğu gibi fırlar (describeApiError: NETWORK_ERROR).
 * - İptal edilirse iptal hatası olduğu gibi fırlar.
 */
export async function streamChatMessage(client: ApiClient, options: ChatStreamOptions): Promise<ChatStreamEnd> {
  const { data, error, response } = await client.POST('/v1/conversations/{conversationId}/messages', {
    params: { path: { conversationId: options.conversationId } },
    body: options.message,
    headers: { Accept: 'text/event-stream' },
    parseAs: 'stream',
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (!response.ok) {
    throw new ApiRequestError(describeApiError(error), response.status);
  }

  // Son olay geri çağırmada yakalanır; nesne içinde tutuluyor ki TypeScript değerini null sanmasın.
  const result: { end: ChatStreamEnd | null } = { end: null };
  if (data) {
    try {
      await readServerSentEvents(data, ({ data: payload }) => {
        const event = parseEvent(payload);
        if (!event) {
          return;
        }
        options.onEvent(event);
        if (event.type === 'done' || event.type === 'error') {
          result.end = event;
        }
      });
    } catch (cause) {
      if (options.signal?.aborted) {
        throw cause;
      }
      // Son olay geldiyse sonradan kopan bağlantı önemsizdir; gelmediyse aşağıda STREAM_INTERRUPTED.
    }
  }
  if (!result.end) {
    throw new ApiRequestError({
      code: STREAM_INTERRUPTED,
      message: 'Bağlantı koptu. Cevap sunucuda tamamlanmış olabilir; tekrar gönderince kaydedilen cevap gelir.',
    });
  }
  return result.end;
}

/** Olayın JSON verisini şemayla doğrular. Tanınmayan olay atlanır: sunucuya yeni olay türü eklenince eski istemci bozulmaz. */
function parseEvent(payload: string): ChatStreamEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return null;
  }
  const parsed = chatStreamEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
