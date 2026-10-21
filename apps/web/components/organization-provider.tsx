'use client';

import { organizationMembershipListSchema } from '@ambarci/shared';
import type { OrganizationMembership } from '@ambarci/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { apiRequest, errorMessage } from '@/lib/api';

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

type LoadResult =
  | { kind: 'ok'; organizations: OrganizationMembership[]; activeId: string | null }
  | { kind: 'error'; message: string };

/** Şirket listesini çeker ve aktif şirketi seçer: istenen (ya da hatırlanan) şirket, yoksa ilki. */
async function loadOrganizations(preferredId?: string): Promise<LoadResult> {
  try {
    const organizations = await apiRequest('/v1/organizations', { schema: organizationMembershipListSchema });
    const wanted = preferredId ?? readStoredId();
    const next = organizations.find((organization) => organization.id === wanted) ?? organizations[0] ?? null;
    if (next) {
      storeId(next.id);
    }
    return { kind: 'ok', organizations, activeId: next?.id ?? null };
  } catch (reason) {
    return { kind: 'error', message: errorMessage(reason) };
  }
}

export function OrganizationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<OrganizationState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const apply = useCallback((result: LoadResult): void => {
    if (result.kind === 'error') {
      setStatus('error');
      setError(result.message);
      return;
    }
    setOrganizations(result.organizations);
    setActiveId(result.activeId);
    setStatus('ready');
    setError(null);
  }, []);

  const reload = useCallback(
    async (preferredId?: string): Promise<void> => apply(await loadOrganizations(preferredId)),
    [apply],
  );

  useEffect(() => {
    let current = true;
    void loadOrganizations().then((result) => {
      if (current) {
        apply(result);
      }
    });
    return () => {
      current = false;
    };
  }, [apply]);

  const value = useMemo<OrganizationState>(
    () => ({
      status,
      error,
      organizations,
      active: organizations.find((organization) => organization.id === activeId) ?? null,
      selectOrganization: (organizationId: string) => {
        setActiveId(organizationId);
        storeId(organizationId);
      },
      reload,
    }),
    [status, error, organizations, activeId, reload],
  );

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganizations(): OrganizationState {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganizations yalnızca OrganizationProvider içinde kullanılabilir.');
  }
  return context;
}
