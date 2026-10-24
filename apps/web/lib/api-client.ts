import { createApiClient, describeApiError } from '@ambarci/api-client';
import type { ApiClient, paths } from '@ambarci/api-client';
import createQueryHooks from 'openapi-react-query';
import type { OpenapiQueryClient } from 'openapi-react-query';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Web panelinin API istemcisi: packages/api-client'taki tipli istemci ve onun TanStack Query sarmalayıcısı.
// Sarmalayıcı burada kurulur ki web'de tek bir React Query kopyası olsun (ADR-005).

/** Render'daki API'nin adresi; build sırasında sayfaya gömülür (docs/yayin.md). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL;

export interface WebApi {
  client: ApiClient;
  /** useQuery ve useMutation: yol, parametre ve cevap tipleri OpenAPI belgesinden gelir. */
  $api: OpenapiQueryClient<paths>;
}

async function accessToken(): Promise<string | null> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * İstemciyi kurar. organizationId verilirse her istek o şirket adına gider (X-Organization-Id); şirket başına ayrı
 * istemci kurulur (components/api-provider.tsx).
 */
export function createWebApi(organizationId: string | null): WebApi {
  const client = createApiClient({ baseUrl: API_URL ?? '', getAccessToken: accessToken, organizationId });
  return { client, $api: createQueryHooks(client) };
}

/** Hata nesnesinden kullanıcıya gösterilecek Türkçe mesaj. */
export function errorMessage(error: unknown): string {
  return describeApiError(error).message;
}
