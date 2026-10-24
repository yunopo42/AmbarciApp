import type { JSX } from 'react';

import { ApiSessionCard } from '@/components/api-session-card';
import { ApiStatusCard } from '@/components/api-status-card';
import { Dashboard } from '@/components/dashboard';

export default function HomePage(): JSX.Element {
  return (
    <>
      <Dashboard />
      <details className="rounded-lg border border-border bg-card p-4 shadow-1">
        <summary className="cursor-pointer text-body-md-medium text-primary">Bağlantı durumu</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <ApiStatusCard />
          <ApiSessionCard />
        </div>
      </details>
    </>
  );
}
