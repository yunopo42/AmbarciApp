'use client';

import type { OrganizationMembership } from '@ambarci/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { OrganizationApiProvider, useApi } from '@/components/api-provider';
import { errorMessage } from '@/lib/api-client';

interface OrganizationState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  organizations: OrganizationMembership[];
  /** Aktif şirket; API'ye X-Organization-Id başlığıyla gider ve orada üyelikle doğrulanır. */
  active: OrganizationMembership | null;
  selectOrganization: (organizationId: string) => void;
  /** Şirket listesini yeniden yükler; verilirse o şirketi aktif yapar (şirket kurma, davetle katılma sonrası). */
  reload: (preferredId?: string) => Promise<void>;
}

const OrganizationContext = createContext<OrganizationState | null>(null);

// Seçilen şirket yalnızca kolaylık için hatırlanır; kullanıcı artık üye değilse yok sayılır.
const STORAGE_KEY = 'ambarci.activeOrganizationId';

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeId(organizationId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, organizationId);
  } catch {
    // Tarayıcı depolaması kapalıysa seçim yalnızca bu sayfa boyunca geçerli olur.
  }
}

/**
 * Kullanıcının şirketlerini yükler ve aktif şirketi tutar: seçilen (ya da hatırlanan) şirket, yoksa ilki. Alt ağaç
 * aktif şirketin istemcisi ve önbelleğiyle sarılır; şirket değişince o katman baştan kurulur.
 */
export function OrganizationProvider({ children }: { children: ReactNode }): JSX.Element {
  // Bu sağlayıcı şirket katmanının üstünde: şirket listesi şirketten bağımsız istemciyle çekilir.
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/organizations');
  const { refetch } = query;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const organizations = useMemo(() => query.data ?? [], [query.data]);
  const active = useMemo(() => {
    const wanted = selectedId ?? (organizations.length > 0 ? readStoredId() : null);
    return organizations.find((organization) => organization.id === wanted) ?? organizations[0] ?? null;
  }, [organizations, selectedId]);

  useEffect(() => {
    if (active) {
      storeId(active.id);
    }
  }, [active]);

  const reload = useCallback(
    async (preferredId?: string): Promise<void> => {
      if (preferredId) {
        setSelectedId(preferredId);
      }
      await refetch();
    },
    [refetch],
  );

  const value = useMemo<OrganizationState>(
    () => ({
      status: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
      error: query.isError ? errorMessage(query.error) : null,
      organizations,
      active,
      selectOrganization: setSelectedId,
      reload,
    }),
    [query.isPending, query.isError, query.error, organizations, active, reload],
  );

  return (
    <OrganizationContext.Provider value={value}>
      {active ? (
        <OrganizationApiProvider key={active.id} organizationId={active.id}>
          {children}
        </OrganizationApiProvider>
      ) : (
        children
      )}
    </OrganizationContext.Provider>
  );
}

export function useOrganizations(): OrganizationState {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganizations yalnızca OrganizationProvider içinde kullanılabilir.');
  }
  return context;
}
