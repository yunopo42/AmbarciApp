import type { OrganizationMembership } from '@ambarci/shared';
import type { JSX, ReactNode } from 'react';

import { useOrganizations } from '@/api/organization-provider';
import { StateMessage } from '@/components/ui';
import { API_URL } from '@/lib/api';

/**
 * Aktif şirket isteyen ekranların ortak kapısı: API adresi yoksa, şirketler yüklenirken, yüklenemezken ya da
 * kullanıcının şirketi yokken bilgi gösterir; aktif şirket varsa içeriği onunla çizer.
 */
export function OrganizationGate({
  children,
}: {
  children: (organization: OrganizationMembership) => ReactNode;
}): JSX.Element {
  const { status, error, active, reload } = useOrganizations();

  if (!API_URL) {
    return <StateMessage message="API adresi tanımlı değil: depo kökündeki .env dosyasına EXPO_PUBLIC_API_URL yazılmalı." />;
  }
  if (status === 'loading') {
    return <StateMessage loading message="Şirketler yükleniyor… Sunucu uykudaysa ilk istek bir dakika sürebilir." />;
  }
  if (status === 'error') {
    return <StateMessage message={error ?? 'Şirketler yüklenemedi.'} onRetry={() => void reload()} />;
  }
  if (!active) {
    return (
      <StateMessage message="Henüz bir şirkete üye değilsin. Web panelinden şirketini kur ya da yöneticinden aldığın davet koduyla katıl." />
    );
  }
  return <>{children(active)}</>;
}
