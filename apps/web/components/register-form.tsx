'use client';

import { describeSignUpError, MIN_PASSWORD_LENGTH } from '@ambarci/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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
      <Card className="w-full max-w-sm p-6" aria-live="polite">
        <Alert variant="applied">{notice}</Alert>
        <Link href="/login" className="text-body-md-medium text-primary-action underline">
          Giriş sayfasına dön
        </Link>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm p-6">
      <CardHeader>
        <CardTitle>Hesap oluştur</CardTitle>
      </CardHeader>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <Field id="email" label="E-posta">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="password" label="Şifre" hint={`En az ${MIN_PASSWORD_LENGTH} karakter.`}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            aria-describedby="password-hint"
          />
        </Field>
        <Field id="passwordRepeat" label="Şifre (tekrar)">
          <Input
            id="passwordRepeat"
            name="passwordRepeat"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={pending}>
          {pending ? 'Hesap oluşturuluyor…' : 'Hesap oluştur'}
        </Button>
      </form>
      <p className="text-text-muted">
        Hesabın var mı?{' '}
        <Link href="/login" className="text-body-md-medium text-primary-action underline">
          Giriş yap
        </Link>
      </p>
    </Card>
  );
}
