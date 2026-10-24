import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Brand } from '@/components/brand';
import { LoginForm } from '@/components/login-form';
import { safeNextPath } from '@/lib/safe-next-path';

export const metadata: Metadata = {
  title: 'Giriş · Ambarcı',
};

export default async function LoginPage(props: PageProps<'/login'>): Promise<JSX.Element> {
  const { next } = await props.searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <h1>
        <Brand subtitle="Yönetim paneli" />
      </h1>
      <LoginForm next={safeNextPath(next)} />
    </main>
  );
}
