import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Brand } from '@/components/brand';
import { RegisterForm } from '@/components/register-form';

export const metadata: Metadata = {
  title: 'Kayıt · Ambarcı',
};

// Hesap açan kişi ardından şirket kurar (yönetici olur) ya da yöneticisinden aldığı davet koduyla katılır.
export default function RegisterPage(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <h1>
        <Brand subtitle="Yönetim paneli" />
      </h1>
      <RegisterForm />
    </main>
  );
}
