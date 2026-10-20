import type { Metadata } from 'next';
import type { JSX } from 'react';

import { LoginForm } from '@/components/login-form';
import { safeNextPath } from '@/lib/safe-next-path';

export const metadata: Metadata = {
  title: 'Giriş · Ambarcı',
};

// Hesaplar yönetici davetiyle açılacak (#18); bu yüzden kayıt formu yok.
export default async function LoginPage(props: PageProps<'/login'>): Promise<JSX.Element> {
  const { next } = await props.searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">Ambarcı</h1>
      <LoginForm next={safeNextPath(next)} />
    </main>
  );
}
