'use client';

import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { API_URL, errorMessage } from '@/lib/api-client';

/** API'nin ayakta olup olmadığı (oturum gerektirmeyen /v1/health). */
export function ApiStatusCard(): JSX.Element {
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/health', {}, { enabled: Boolean(API_URL) });

  let message: string;
  if (!API_URL) {
    message = 'NEXT_PUBLIC_API_URL tanımlı değil.';
  } else if (query.isPending) {
    message = 'Kontrol ediliyor… Sunucu uykudaysa ilk istek yaklaşık bir dakika sürebilir.';
  } else if (query.isError) {
    message = errorMessage(query.error);
  } else {
    message = `Çalışıyor (status: ${query.data.status})`;
  }

  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-title-md">
          API durumu
          {query.isSuccess ? <Badge variant="applied">Çalışıyor</Badge> : null}
          {query.isError || !API_URL ? <Badge variant="critical">Ulaşılamıyor</Badge> : null}
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      {API_URL ? <p className="break-all text-label-md font-normal text-text-subtle">{API_URL}</p> : null}
    </Card>
  );
}
