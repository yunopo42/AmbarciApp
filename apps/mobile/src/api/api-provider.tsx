import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { createMobileApi } from '@/lib/api';
import type { MobileApi } from '@/lib/api';

const ApiContext = createContext<MobileApi | null>(null);

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Hata cevapları (4xx) tekrar denense de değişmez; yalnızca bir kez tekrar denenir (ör. ağ kopması).
      queries: { retry: 1, staleTime: 30_000 },
      // Bir değişikliği kendiliğinden tekrar göndermek, kullanıcının bilmediği ikinci bir işlem demektir.
      mutations: { retry: false },
    },
  });
}

/**
 * Şirketten bağımsız istemci ve sorgu önbelleği (şirket listesi). Oturum açan kullanıcı değişince baştan kurulur
 * (src/app/_layout.tsx, key = kullanıcı kimliği); önceki kullanıcının verisi önbellekte kalmaz.
 */
export function ApiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(createQueryClient);
  const [api] = useState(() => createMobileApi(null));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * Aktif şirkete bağlı istemci ve ona ait ayrı sorgu önbelleği. Çağıran key={organizationId} ile kullanır: şirket
 * değişince ikisi de baştan kurulur, bir şirketin cevabı ötekinin ekranında görünemez (web'dekiyle aynı yapı).
 */
export function OrganizationApiProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}): JSX.Element {
  const [queryClient] = useState(createQueryClient);
  const [api] = useState(() => createMobileApi(organizationId));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

/** En yakın sağlayıcının istemcisi: aktif şirket varsa onun adına, yoksa şirketten bağımsız. */
export function useApi(): MobileApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi yalnızca ApiProvider içinde kullanılabilir.');
  }
  return api;
}
