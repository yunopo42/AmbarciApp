'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import { CreateOrganizationForm } from '@/components/create-organization-form';
import { JoinOrganizationForm } from '@/components/join-organization-form';
import { useOrganizations } from '@/components/organization-provider';
import { ROLE_LABELS } from '@/lib/labels';

// Geçici ana sayfa. Gösterge paneli (stok özeti, onay kuyruğu) sonraki haftalarda gelecek.
export function Dashboard(): JSX.Element {
  const { status, error, active, reload } = useOrganizations();

  if (status === 'loading') {
    return <p aria-live="polite">Şirketler yükleniyor… Sunucu uykudaysa ilk istek bir dakika sürebilir.</p>;
  }
  if (status === 'error') {
    return (
      <section className="flex flex-col items-center gap-3" aria-live="polite">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void reload()} className="rounded border px-4 py-2">
          Tekrar dene
        </button>
      </section>
    );
  }

  if (!active) {
    return (
      <section className="flex w-full max-w-3xl flex-col gap-4">
        <p>Başlamak için şirketini kur ya da yöneticinden aldığın davet koduyla katıl.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <CreateOrganizationForm />
          <JoinOrganizationForm />
        </div>
      </section>
    );
  }

  return (
    <section className="flex w-full max-w-3xl flex-col gap-4">
      <div className="rounded border p-4">
        <h2 className="text-lg font-semibold">{active.name}</h2>
        <p>Rolün: {ROLE_LABELS[active.role]}</p>
        <ul className="mt-2 list-disc pl-6">
          <li>
            <Link href="/warehouses" className="underline">
              Depoları gör
            </Link>
          </li>
          {active.role === 'ADMIN' ? (
            <li>
              <Link href="/members" className="underline">
                Üyeleri yönet ve davet kodu üret
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
      <details className="rounded border p-4">
        <summary className="cursor-pointer">Başka bir şirkete katıl ya da yeni şirket kur</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <JoinOrganizationForm />
          <CreateOrganizationForm />
        </div>
      </details>
    </section>
  );
}
