'use client';

import { Boxes, Contact, LayoutDashboard, Package, Users, Warehouse } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { JSX, ReactNode } from 'react';

import { Brand } from '@/components/brand';
import { useOrganizations } from '@/components/organization-provider';
import { SignOutButton } from '@/components/sign-out-button';
import { NativeSelect } from '@/components/ui/input';
import { ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Yalnızca yöneticiye gösterilir. Asıl yetki API'de denetlenir; menü yalnızca gereksiz bağlantıyı gizler. */
  adminOnly?: boolean;
  /** Bu bölüme ait sayılan diğer adresler (ör. stok işlemi sayfaları Stok altında). */
  also?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Gösterge paneli', icon: LayoutDashboard },
  { href: '/stock', label: 'Stok', icon: Boxes, also: ['/operations'] },
  { href: '/products', label: 'Ürünler', icon: Package },
  { href: '/warehouses', label: 'Depolar', icon: Warehouse },
  { href: '/parties', label: 'Cariler', icon: Contact },
  { href: '/members', label: 'Üyeler', icon: Users, adminOnly: true },
];

function isCurrent(pathname: string, item: NavItem): boolean {
  if (item.href === '/') {
    return pathname === '/';
  }
  return [item.href, ...(item.also ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

/**
 * Oturumlu sayfaların iskeleti (docs/tasarim.md, web): solda sabit menü, sağda en fazla 1280 px genişlikte ortalanan
 * içerik, kenar boşluğu 32 px. Dar ekranda menü içeriğin üstüne geçer.
 */
export function AppShell({ email, children }: { email: string | null; children: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const { organizations, active, selectOrganization } = useOrganizations();
  const items = active ? NAV_ITEMS.filter((item) => !item.adminOnly || active.role === 'ADMIN') : [];

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="flex flex-col gap-6 border-b border-border bg-card p-4 lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <Link href="/" className="rounded-md focus-visible:outline-2 focus-visible:outline-primary-action">
          <Brand subtitle={organizations.length > 1 ? null : active?.name} />
        </Link>

        {organizations.length > 1 && active ? (
          <label className="flex flex-col gap-1">
            <span className="text-label-sm uppercase text-text-subtle">Şirket</span>
            <NativeSelect value={active.id} onChange={(event) => selectOrganization(event.target.value)}>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}

        {items.length > 0 ? (
          <nav aria-label="Ana menü">
            <ul className="flex flex-wrap gap-1 lg:flex-col">
              {items.map((item) => {
                const current = isCurrent(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex min-h-12 items-center gap-3 rounded-md px-3 text-body-lg text-text-muted hover:bg-divider focus-visible:outline-2 focus-visible:outline-primary-action',
                        current && 'bg-primary-soft text-body-lg-bold text-primary hover:bg-primary-soft',
                      )}
                    >
                      <Icon aria-hidden className="size-5 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-divider pt-4 lg:mt-auto">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-body-md-medium text-text">{email}</span>
            {active ? <span className="text-label-md font-normal text-text-muted">{ROLE_LABELS[active.role]}</span> : null}
          </div>
          <SignOutButton />
        </div>
      </aside>

      <main className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
