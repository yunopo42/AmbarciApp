// OpenAPI'den üretilen tipli API istemcisi (ADR-005). Web ve mobil aynı istemciyi kullanır.
//
// schema.ts elle düzenlenmez: kök dizinde "pnpm gen:api" API'den OpenAPI belgesini (openapi.json) ve ondan
// tipleri üretir; CI, üretilmiş dosyalar güncel değilse başarısız olur. TanStack Query sarmalayıcısı
// (openapi-react-query) bu pakette değil, her uygulamada kurulur: uygulamada tek bir React Query kopyası olsun ve
// QueryClientProvider ile sorgular aynı kopyayı kullansın.
import { ORGANIZATION_HEADER } from '@ambarci/shared';
import createClient from 'openapi-fetch';
import type { Client, Middleware } from 'openapi-fetch';

import type { components, paths } from './schema.js';

export type { components, paths } from './schema.js';
export { ApiRequestError, describeApiError } from './errors.js';
export { splitBoldText } from './bold-text.js';
export type { TextSegment } from './bold-text.js';
export type { ApiFailure } from './errors.js';
export { readServerSentEvents, STREAM_INTERRUPTED, streamChatMessage } from './chat-stream.js';
export type { ChatStreamEnd, ChatStreamOptions, ServerSentEvent } from './chat-stream.js';
export { applyChatEvent, buildChatRows, failTurn, randomUuid, startTurn, turnStatusLabel } from './chat-turn.js';
export type { ChatRow, ChatTurn, ChatTurnStatus, SavedChatMessage } from './chat-turn.js';

export type ApiClient = Client<paths>;

/** API'nin hata gövdesi: { error: { code, message, details? } }. */
export type ApiErrorBody = components['schemas']['ApiErrorDto'];

export interface ApiClientOptions {
  /** API'nin adresi, ör. https://ambarci-api.onrender.com (yollar /v1 ile başlar). */
  baseUrl: string;
  /** Oturumdaki erişim token'ı. Oturum yoksa null: istek token'sız gider, API 401 döner. */
  getAccessToken: () => Promise<string | null>;
  /**
   * Aktif şirket. İstemci şirket başına kurulur; kullanıcı şirket değiştirince yeni istemci (ve yeni sorgu
   * önbelleği) kurulur. Böylece bir şirketin cevabı başka şirketin ekranında görünemez.
   */
  organizationId?: string | null;
  /** fetch yerine geçecek fonksiyon (testler). Verilmezse ortamın fetch'i kullanılır. */
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * Tipli istemciyi kurar. Oturum token'ı (Authorization) ve aktif şirket (X-Organization-Id) tek bir ara katmanda,
 * her isteğe eklenir; çağıran kod başlıklarla uğraşmaz. Token her istekte yeniden alınır: Supabase oturumu
 * yeniledikçe en güncel token gider.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const session: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken();
      if (token) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      if (options.organizationId) {
        request.headers.set(ORGANIZATION_HEADER, options.organizationId);
      }
      return request;
    },
  };
  client.use(session);
  return client;
}
