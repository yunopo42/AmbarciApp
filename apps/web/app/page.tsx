import type { JSX } from 'react';

import { ApiSessionCard } from '@/components/api-session-card';
import { ApiStatusCard } from '@/components/api-status-card';
import { SignOutButton } from '@/components/sign-out-button';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Geçici giriş sayfası. Ekran tasarımı docs/tasarim.md ile gelecek (#20).
// Oturum yoksa bu sayfaya proxy.ts nedeniyle hiç gelinmez.
export default async function HomePage(): Promise<JSX.Element> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === 'string' ? data.claims.email : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">Ambarcı</h1>
      <p>Yönetim paneli kurulum aşamasında.</p>
      {email ? <p>Giriş yapan: {email}</p> : null}
      <ApiStatusCard />
      <ApiSessionCard />
      <SignOutButton />
    </main>
  );
}
