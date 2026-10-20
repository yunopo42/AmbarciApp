'use client';

import { apiErrorSchema, authUserSchema } from '@ambarci/shared';
import type { AuthUser } from '@ambarci/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type SessionStatus =
  | { kind: 'loading' }
  | { kind: 'ok'; user: AuthUser }
  | { kind: 'error'; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL;

// Geçici: packages/api-client (OpenAPI'den üretilen istemci) 3. haftada geldiğinde
// bu elle yazılmış fetch onunla değiştirilecek.
// Tarayıcıdaki oturum token'ı API'ye gönderilir; API token'ı Supabase'in anahtarlarıyla doğrular (#17).
async function fetchMe(apiUrl: string, signal: AbortSignal): Promise<SessionStatus> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { kind: 'error', message: 'Oturum bulunamadı.' };
  }
  try {
    const response = await fetch(new URL('/v1/auth/me', apiUrl), {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: 'no-store',
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      return {
        kind: 'error',
        message: parsed.success ? parsed.data.error.message : `API ${response.status} koduyla cevap verdi.`,
      };
    }
    const parsed = authUserSchema.safeParse(body);
    return parsed.success
      ? { kind: 'ok', user: parsed.data }
      : { kind: 'error', message: 'API beklenmeyen bir cevap döndü.' };
  } catch {
    return { kind: 'error', message: 'API’ye ulaşılamadı.' };
  }
}

function describeStatus(status: SessionStatus): string {
  switch (status.kind) {
    case 'loading':
      return 'Kontrol ediliyor…';
    case 'ok':
      return `API oturumu doğruladı: ${status.user.email ?? status.user.id}`;
    case 'error':
      return status.message;
  }
}

/** Web oturumunun API tarafından da tanındığını gösterir. */
export function ApiSessionCard(): JSX.Element {
  const [status, setStatus] = useState<SessionStatus>(
    API_URL ? { kind: 'loading' } : { kind: 'error', message: 'NEXT_PUBLIC_API_URL tanımlı değil.' },
  );

  useEffect(() => {
    if (!API_URL) {
      return;
    }
    const controller = new AbortController();
    void fetchMe(API_URL, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    });
    return () => controller.abort();
  }, []);

  return (
    <section aria-live="polite" className="rounded border p-4 text-center">
      <h2 className="font-semibold">API oturumu</h2>
      <p>{describeStatus(status)}</p>
    </section>
  );
}
