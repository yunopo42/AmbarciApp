import { apiErrorSchema, ORGANIZATION_HEADER } from '@ambarci/shared';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Geçici: packages/api-client (OpenAPI'den üretilen istemci) 3. haftada geldiğinde bu elle yazılmış
// istemci onunla değiştirilecek.

/** API'nin { error: { code, message } } cevabı ya da ağ hatası. message kullanıcıya gösterilebilir. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Aktif şirket; API üyeliği doğrular. */
  organizationId?: string;
  /** Cevabı doğrulayan ortak şema. 204 cevaplarında verilmez. */
  schema?: { parse: (value: unknown) => T };
}

/** Oturum token'ını ve aktif şirket başlığını ekleyerek API'yi çağırır. */
export async function apiRequest<T = void>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new ApiError(0, 'CONFIG_MISSING', 'NEXT_PUBLIC_API_URL tanımlı değil.');
  }
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Oturumun kapanmış; yeniden giriş yap.');
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.organizationId) {
    headers[ORGANIZATION_HEADER] = options.organizationId;
  }

  let response: Response;
  try {
    response = await fetch(new URL(path, apiUrl), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'API’ye ulaşılamadı. Sunucu uykudaysa bir dakika sonra tekrar deneyin.');
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, 'UNEXPECTED', `API ${response.status} koduyla cevap verdi.`);
  }
  if (!options.schema || response.status === 204) {
    return undefined as T;
  }
  return options.schema.parse(await response.json());
}

/** Hata nesnesinden kullanıcıya gösterilecek mesaj. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.';
}
