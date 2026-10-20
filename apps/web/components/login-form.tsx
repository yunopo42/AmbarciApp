'use client';

import { describeSignInError } from '@ambarci/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Tasarım değerleri (renk, yazı tipi, boşluk) docs/tasarim.md hazırlanınca uygulanacak (#20).
export function LoginForm({ next }: { next: string }): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);

    const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    });
    if (signInError) {
      setError(describeSignInError(signInError));
      setPending(false);
      return;
    }
    // Sunucu bileşenleri yeni oturum çerezleriyle yeniden çizilsin.
    router.replace(next);
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex w-full max-w-sm flex-col gap-4 rounded border p-6"
    >
      <h2 className="text-lg font-semibold">Giriş yap</h2>
      <label className="flex flex-col gap-1">
        <span>E-posta</span>
        <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Şifre</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded border px-3 py-2"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending} className="rounded border px-4 py-2 font-medium">
        {pending ? 'Giriş yapılıyor…' : 'Giriş yap'}
      </button>
    </form>
  );
}
