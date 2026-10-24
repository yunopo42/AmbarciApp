'use client';

import { describeSignInError } from '@ambarci/shared';
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
    <Card className="w-full max-w-sm p-6">
      <CardHeader>
        <CardTitle>Giriş yap</CardTitle>
      </CardHeader>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <Field id="email" label="E-posta">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="password" label="Şifre">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={pending}>
          {pending ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </Button>
      </form>
      <p className="text-text-muted">
        Hesabın yok mu?{' '}
        <Link href="/register" className="text-body-md-medium text-primary-action underline">
          Hesap oluştur
        </Link>
      </p>
    </Card>
  );
}
