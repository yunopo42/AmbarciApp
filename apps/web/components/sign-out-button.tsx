'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { JSX } from 'react';

import { Button } from '@/components/ui/button';
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
    <Button variant="secondary" size="sm" onClick={() => void handleClick()} disabled={pending}>
      <LogOut aria-hidden />
      {pending ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
    </Button>
  );
}
