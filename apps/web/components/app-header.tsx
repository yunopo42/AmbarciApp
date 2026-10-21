'use client';

import Link from 'next/link';
import type { JSX } from 'react';

import { useOrganizations } from '@/components/organization-provider';
import { SignOutButton } from '@/components/sign-out-button';
import { ROLE_LABELS } from '@/lib/labels';

export function AppHeader({ email }: { email: string | null }): JSX.Element {
  const { organizations, active, selectOrganization } = useOrganizations();

  return (
    <header className="flex flex-wrap items-center gap-4 border-b p-4">
      <Link href="/" className="text-lg font-semibold">
        Ambarcı
      </Link>
      {organizations.length > 1 && active ? (
        <label className="flex items-center gap-2">
          <span className="text-sm">Şirket</span>
          <select
            value={active.id}
            onChange={(event) => selectOrganization(event.target.value)}
            className="rounded border px-2 py-1"
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
      ) : active ? (
        <span>{active.name}</span>
      ) : null}
      {active ? (
        <nav className="flex gap-4">
          <Link href="/warehouses" className="underline">
            Depolar
          </Link>
          {active.role === 'ADMIN' ? (
            <Link href="/members" className="underline">
              Üyeler
            </Link>
          ) : null}
        </nav>
      ) : null}
      <span className="ml-auto text-sm">
        {email}
        {active ? ` · ${ROLE_LABELS[active.role]}` : ''}
      </span>
      <SignOutButton />
    </header>
  );
}
