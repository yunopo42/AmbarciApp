'use client';

import type { JSX } from 'react';

import { useApi } from '@/components/api-provider';
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
    <section aria-live="polite" className="rounded border p-4 text-center">
      <h2 className="font-semibold">API durumu</h2>
      <p>{message}</p>
      {API_URL ? <p className="text-sm">{API_URL}</p> : null}
    </section>
  );
}
