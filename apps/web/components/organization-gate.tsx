'use client';

import type { OrganizationMembership } from '@ambarci/shared';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { useOrganizations } from '@/components/organization-provider';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Aktif şirket isteyen ekranların ortak kapısı: şirketler yüklenirken, yüklenemezken ya da kullanıcının şirketi
 * yokken bilgi gösterir; aktif şirket varsa içeriği onunla çizer. Şirket değişince içerik şirket katmanıyla birlikte
 * baştan kurulur (organization-provider.tsx), önceki şirketin verisi görünmez.
 */
export function OrganizationGate({
  adminOnly = false,
  children,
}: {
  adminOnly?: boolean;
  children: (organization: OrganizationMembership) => ReactNode;
}): JSX.Element {
  const { status, error, active, reload } = useOrganizations();

  if (status === 'loading') {
    return (
      <p aria-live="polite" className="text-text-muted">
        Şirketler yükleniyor… Sunucu uykudaysa ilk istek bir dakika sürebilir.
      </p>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert>{error}</Alert>
        <Button variant="secondary" onClick={() => void reload()}>
          Tekrar dene
        </Button>
      </div>
    );
  }
  if (!active) {
    return (
      <p>
        Önce{' '}
        <Link href="/" className="text-primary-action underline">
          ana sayfadan
        </Link>{' '}
        bir şirket kur ya da bir şirkete katıl.
      </p>
    );
  }
  if (adminOnly && active.role !== 'ADMIN') {
    return <p>Bu sayfa yalnızca şirket yöneticilerine açık.</p>;
  }
  return <>{children(active)}</>;
}
