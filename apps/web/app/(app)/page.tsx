import type { JSX } from 'react';

import { ApiSessionCard } from '@/components/api-session-card';
import { ApiStatusCard } from '@/components/api-status-card';
import { Dashboard } from '@/components/dashboard';

// Ekran tasarımı docs/tasarim.md ile gelecek (#20).
export default function HomePage(): JSX.Element {
  return (
    <>
      <Dashboard />
      <details className="w-full max-w-3xl rounded border p-4">
        <summary className="cursor-pointer">Bağlantı durumu</summary>
        <div className="mt-4 flex flex-wrap justify-center gap-4">
          <ApiStatusCard />
          <ApiSessionCard />
        </div>
      </details>
    </>
  );
}
