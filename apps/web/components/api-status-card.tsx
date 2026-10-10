'use client';

import { healthResponseSchema } from '@ambarci/shared';
import type { HealthResponse } from '@ambarci/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

type ApiStatus =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error'; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Geçici: packages/api-client (OpenAPI'den üretilen istemci) 3. haftada geldiğinde
// bu elle yazılmış fetch onunla değiştirilecek.
async function fetchHealth(apiUrl: string, signal: AbortSignal): Promise<ApiStatus> {
  try {
    const response = await fetch(new URL('/v1/health', apiUrl), { signal, cache: 'no-store' });
    if (!response.ok) {
      return { kind: 'error', message: `API ${response.status} koduyla cevap verdi.` };
    }
    const parsed = healthResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { kind: 'ok', data: parsed.data }
      : { kind: 'error', message: 'API beklenmeyen bir cevap döndü.' };
  } catch {
    return { kind: 'error', message: 'API’ye ulaşılamadı.' };
  }
}

function describeStatus(status: ApiStatus): string {
  switch (status.kind) {
    case 'loading':
      return 'Kontrol ediliyor… Sunucu uykudaysa ilk istek yaklaşık bir dakika sürebilir.';
    case 'ok':
      return `Çalışıyor (status: ${status.data.status})`;
    case 'error':
      return status.message;
  }
}

export function ApiStatusCard(): JSX.Element {
  const [status, setStatus] = useState<ApiStatus>(
    API_URL
      ? { kind: 'loading' }
      : { kind: 'error', message: 'NEXT_PUBLIC_API_URL tanımlı değil.' },
  );

  useEffect(() => {
    if (!API_URL) {
      return;
    }
    const controller = new AbortController();
    void fetchHealth(API_URL, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    });
    return () => controller.abort();
  }, []);

  return (
    <section aria-live="polite" className="rounded border p-4 text-center">
      <h2 className="font-semibold">API durumu</h2>
      <p>{describeStatus(status)}</p>
      {API_URL ? <p className="text-sm">{API_URL}</p> : null}
    </section>
  );
}
