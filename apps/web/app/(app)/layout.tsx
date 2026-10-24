import type { JSX, ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';
import { OrganizationProvider } from '@/components/organization-provider';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Oturum isteyen sayfaların ortak düzeni: sol menü ve aktif şirket bağlamı.
// Oturum yoksa bu sayfalara proxy.ts nedeniyle hiç gelinmez.
export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === 'string' ? data.claims.email : null;

  return (
    <OrganizationProvider>
      <AppShell email={email}>{children}</AppShell>
    </OrganizationProvider>
  );
}
