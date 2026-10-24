import { createApiClient, describeApiError } from '@ambarci/api-client';
import type { ApiClient, paths } from '@ambarci/api-client';
import Constants from 'expo-constants';
import createQueryHooks from 'openapi-react-query';
import type { OpenapiQueryClient } from 'openapi-react-query';

import { supabase } from './supabase';

// Mobilin API istemcisi: packages/api-client'taki tipli istemci ve onun TanStack Query sarmalayıcısı. Sarmalayıcı
// burada kurulur ki uygulamada tek bir React Query kopyası olsun (ADR-005).

function readApiUrl(): string | null {
  const extra = Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined;
  return typeof extra?.apiUrl === 'string' && extra.apiUrl ? extra.apiUrl.replace(/\/+$/, '') : null;
}

/** API'nin adresi (EXPO_PUBLIC_API_URL, app.config.js). Telefondan erişilebilir olmalı: Render ya da bilgisayarın ağ adresi. */
export const API_URL = readApiUrl();

export interface MobileApi {
  client: ApiClient;
  /** useQuery, useInfiniteQuery ve useMutation: yol, parametre ve cevap tipleri OpenAPI belgesinden gelir. */
  $api: OpenapiQueryClient<paths>;
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * İstemciyi kurar. organizationId verilirse her istek o şirket adına gider (X-Organization-Id); şirket başına ayrı
 * istemci kurulur (src/api/api-provider.tsx).
 */
export function createMobileApi(organizationId: string | null): MobileApi {
  const client = createApiClient({ baseUrl: API_URL ?? '', getAccessToken: accessToken, organizationId });
  return { client, $api: createQueryHooks(client) };
}

/** Hata nesnesinden kullanıcıya gösterilecek Türkçe mesaj. */
export function errorMessage(error: unknown): string {
  return describeApiError(error).message;
}
