import type { OrganizationMembership } from '@ambarci/shared';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { OrganizationApiProvider, useApi } from '@/api/api-provider';
import { errorMessage } from '@/lib/api';

interface OrganizationState {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  organizations: OrganizationMembership[];
  /** Aktif şirket; API'ye X-Organization-Id başlığıyla gider ve orada üyelikle doğrulanır. */
  active: OrganizationMembership | null;
  selectOrganization: (organizationId: string) => void;
  reload: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationState | null>(null);

// Seçilen şirket yalnızca kolaylık için hatırlanır; kullanıcı artık üye değilse yok sayılır.
const STORAGE_KEY = 'ambarci.activeOrganizationId';
const NO_ORGANIZATIONS: OrganizationMembership[] = [];

/**
 * Kullanıcının şirketlerini yükler ve aktif şirketi tutar: seçilen (ya da hatırlanan) şirket, yoksa ilki; tek şirket
 * varsa kendiliğinden o seçilir. Alt ağaç aktif şirketin istemcisi ve önbelleğiyle sarılır.
 */
export function OrganizationProvider({ children }: { children: ReactNode }): JSX.Element {
  // Bu sağlayıcı şirket katmanının üstünde: şirket listesi şirketten bağımsız istemciyle çekilir.
  const { $api } = useApi();
  const query = $api.useQuery('get', '/v1/organizations');
  const { refetch } = query;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storedId, setStoredId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((value) => {
        if (mounted) {
          setStoredId(value);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const organizations = query.data ?? NO_ORGANIZATIONS;
  const active = useMemo(() => {
    const wanted = selectedId ?? storedId;
    return organizations.find((organization) => organization.id === wanted) ?? organizations[0] ?? null;
  }, [organizations, selectedId, storedId]);

  const selectOrganization = useCallback((organizationId: string) => {
    setSelectedId(organizationId);
    // Depoya yazılamazsa seçim yalnızca bu oturum boyunca geçerli olur.
    SecureStore.setItemAsync(STORAGE_KEY, organizationId).catch(() => undefined);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    await refetch();
  }, [refetch]);

  const value = useMemo<OrganizationState>(
    () => ({
      status: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
      error: query.isError ? errorMessage(query.error) : null,
      organizations,
      active,
      selectOrganization,
      reload,
    }),
    [query.isPending, query.isError, query.error, organizations, active, selectOrganization, reload],
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
