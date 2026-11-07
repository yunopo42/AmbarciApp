import { apiErrorSchema } from '@ambarci/shared';

/** Kullanıcıya gösterilebilecek hata: API'nin sabit kodu ve Türkçe mesajı. */
export interface ApiFailure {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * İstemcinin kendisinin fırlattığı hata (ör. sohbet akışı): içinde kullanıcıya gösterilecek kod ve mesaj, varsa HTTP
 * durum kodu taşır. Tipli istemcinin diğer çağrıları hata gövdesini olduğu gibi döner; describeApiError ikisini de
 * aynı biçime getirir.
 */
export class ApiRequestError extends Error {
  readonly failure: ApiFailure;
  readonly status: number | null;

  constructor(failure: ApiFailure, status: number | null = null) {
    super(failure.message);
    this.name = 'ApiRequestError';
    this.failure = failure;
    this.status = status;
  }
}

/**
 * Bir istek hatasını tek biçime getirir. API'nin hata gövdesi olduğu gibi döner; ağ hatası (sunucu uykuda, internet
 * yok) ve beklenmeyen cevaplar için de bir kod ve Türkçe mesaj verilir.
 */
export function describeApiError(error: unknown): ApiFailure {
  if (error instanceof ApiRequestError) {
    return error.failure;
  }
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
