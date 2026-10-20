'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { JSX } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignOutButton(): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick(): Promise<void> {
    setPending(true);
    // Yalnızca bu tarayıcıdaki oturum kapanır; kullanıcının telefondaki oturumu açık kalır.
    await createSupabaseBrowserClient().auth.signOut({ scope: 'local' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <button type="button" onClick={() => void handleClick()} disabled={pending} className="rounded border px-4 py-2">
      {pending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
    </button>
  );
}
