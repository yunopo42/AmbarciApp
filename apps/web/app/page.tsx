import type { JSX } from 'react';

import { ApiStatusCard } from '@/components/api-status-card';

// Geçici giriş sayfası. Ekran tasarımı 2. haftada docs/tasarim.md ile gelecek.
export default function HomePage(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">Ambarcı</h1>
      <p>Yönetim paneli kurulum aşamasında.</p>
      <ApiStatusCard />
    </main>
  );
}
