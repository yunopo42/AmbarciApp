'use client';

import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { API_URL, errorMessage } from '@/lib/api-client';

/**
 * Web oturumunun API tarafından da tanındığını gösterir: tarayıcıdaki oturum token'ı istemcinin ara katmanında
 * eklenir; API token'ı Supabase'in anahtarlarıyla doğrular (#17).
 */
export function ApiSessionCard(): JSX.Element {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/auth/me', {}, { enabled: Boolean(API_URL) });

  let message: string;
  if (!API_URL) {
    message = 'NEXT_PUBLIC_API_URL tanımlı değil.';
  } else if (query.isPending) {
    message = 'Kontrol ediliyor…';
  } else if (query.isError) {
    message = errorMessage(query.error);
  } else {
    message = `API oturumu doğruladı: ${query.data.email ?? query.data.id}`;
  }

  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-title-md">
          API oturumu
          {query.isSuccess ? <Badge variant="applied">Doğrulandı</Badge> : null}
          {query.isError ? <Badge variant="critical">Hata</Badge> : null}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}
