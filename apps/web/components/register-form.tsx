'use client';

import { describeSignUpError, MIN_PASSWORD_LENGTH } from '@ambarci/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Tasarım değerleri (renk, yazı tipi, boşluk) docs/tasarim.md hazırlanınca uygulanacak (#20).
export function RegisterForm(): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('passwordRepeat') ?? '')) {
      setError('Şifreler birbirini tutmuyor.');
      return;
    }
    setPending(true);
    setError(null);

    const { data, error: signUpError } = await createSupabaseBrowserClient().auth.signUp({
      email: String(form.get('email') ?? '').trim(),
      password,
    });
    if (signUpError) {
      setError(describeSignUpError(signUpError));
      setPending(false);
      return;
    }
    if (!data.session) {
      // Supabase'de e-posta doğrulaması açıksa oturum hemen açılmaz.
      setNotice('Hesap oluşturuldu. E-postana gelen bağlantıyla adresini doğrulayıp giriş yap.');
      setPending(false);
      return;
    }
    // Yeni kullanıcı ana sayfada şirket kurar ya da davet koduyla katılır.
    router.replace('/');
    router.refresh();
  }

  if (notice) {
    return (
      <section className="flex w-full max-w-sm flex-col gap-4 rounded border p-6" aria-live="polite">
        <p>{notice}</p>
        <Link href="/login" className="underline">
          Giriş sayfasına dön
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex w-full max-w-sm flex-col gap-4 rounded border p-6">
      <h2 className="text-lg font-semibold">Hesap oluştur</h2>
      <label className="flex flex-col gap-1">
        <span>E-posta</span>
        <input name="email" type="email" autoComplete="email" required className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span>Şifre (en az {MIN_PASSWORD_LENGTH} karakter)</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className="rounded border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>Şifre (tekrar)</span>
        <input
          name="passwordRepeat"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className="rounded border px-3 py-2"
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending} className="rounded border px-4 py-2 font-medium">
        {pending ? 'Hesap oluşturuluyor…' : 'Hesap oluştur'}
      </button>
      <p className="text-sm">
        Hesabın var mı?{' '}
        <Link href="/login" className="underline">
          Giriş yap
        </Link>
      </p>
    </form>
  );
}
