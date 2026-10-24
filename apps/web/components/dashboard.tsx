'use client';

import { Contact, Package, Users, Warehouse } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { JSX } from 'react';

import { CreateOrganizationForm } from '@/components/create-organization-form';
import { JoinOrganizationForm } from '@/components/join-organization-form';
import { OrganizationGate } from '@/components/organization-gate';
import { useOrganizations } from '@/components/organization-provider';
import { PageHeader } from '@/components/page-header';
import { ROLE_LABELS } from '@/lib/labels';

interface Shortcut {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { href: '/products', title: 'Ürünler', description: 'Stok kartları, birimler ve alternatif adlar', icon: Package },
  { href: '/warehouses', title: 'Depolar', description: 'Depo, şube ve araç depoları', icon: Warehouse },
  { href: '/parties', title: 'Cariler', description: 'Tedarikçiler ve müşteriler', icon: Contact },
  { href: '/members', title: 'Üyeler', description: 'Davet kodu ve depo yetkileri', icon: Users, adminOnly: true },
];

// Geçici ana sayfa. Gösterge paneli (stok özeti, onay kuyruğu) 6. haftada gelecek (docs/tasarim.md, ekran 3).
export function Dashboard(): JSX.Element {
  const { status, active } = useOrganizations();

  if (status === 'ready' && !active) {
    return (
      <>
        <PageHeader title="Hoş geldin" description="Başlamak için şirketini kur ya da yöneticinden aldığın davet koduyla katıl." />
        <div className="grid gap-4 md:grid-cols-2">
          <CreateOrganizationForm />
          <JoinOrganizationForm />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Gösterge paneli"
        description={active ? `${active.name} · ${ROLE_LABELS[active.role]}` : undefined}
      />
      <OrganizationGate>
        {(organization) => (
          <>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SHORTCUTS.filter((item) => !item.adminOnly || organization.role === 'ADMIN').map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-1 hover:border-border-strong hover:shadow-2 focus-visible:outline-2 focus-visible:outline-primary-action"
                    >
                      <span className="flex size-10 items-center justify-center rounded-md bg-primary-soft text-primary">
                        <Icon aria-hidden className="size-5" />
                      </span>
                      <span className="text-title-md text-text">{item.title}</span>
                      <span className="text-body-md text-text-muted">{item.description}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <details className="rounded-lg border border-border bg-card p-4 shadow-1">
              <summary className="cursor-pointer text-body-md-medium text-primary">
                Başka bir şirkete katıl ya da yeni şirket kur
              </summary>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <JoinOrganizationForm />
                <CreateOrganizationForm />
              </div>
            </details>
          </>
        )}
      </OrganizationGate>
    </>
  );
}
