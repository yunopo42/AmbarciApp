// OpenAPI'den üretilen tipli API istemcisi (ADR-005). Web ve mobil aynı istemciyi kullanır.
//
// schema.ts elle düzenlenmez: kök dizinde "pnpm gen:api" API'den OpenAPI belgesini (openapi.json) ve ondan
// tipleri üretir; CI, üretilmiş dosyalar güncel değilse başarısız olur. TanStack Query sarmalayıcısı
// (openapi-react-query) bu pakette değil, her uygulamada kurulur: uygulamada tek bir React Query kopyası olsun ve
// QueryClientProvider ile sorgular aynı kopyayı kullansın.
import { apiErrorSchema, ORGANIZATION_HEADER } from '@ambarci/shared';
import createClient from 'openapi-fetch';
import type { Client, Middleware } from 'openapi-fetch';

import type { components, paths } from './schema.js';

export type { components, paths } from './schema.js';

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

/** Kullanıcıya gösterilebilecek hata: API'nin sabit kodu ve Türkçe mesajı. */
export interface ApiFailure {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Bir istek hatasını tek biçime getirir. API'nin hata gövdesi olduğu gibi döner; ağ hatası (sunucu uykuda, internet
 * yok) ve beklenmeyen cevaplar için de bir kod ve Türkçe mesaj verilir.
 */
export function describeApiError(error: unknown): ApiFailure {
  const parsed = apiErrorSchema.safeParse(error);
  if (parsed.success) {
    return parsed.data.error;
  }
  if (error instanceof TypeError) {
    // fetch, sunucuya ulaşamadığında TypeError fırlatır.
    return {
      code: 'NETWORK_ERROR',
      message: "API'ye ulaşılamadı. Sunucu uykudaysa bir dakika sonra tekrar deneyin.",
    };
  }
  return { code: 'UNEXPECTED', message: 'Beklenmeyen bir hata oluştu.' };
}
