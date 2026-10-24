'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { createWebApi } from '@/lib/api-client';
import type { WebApi } from '@/lib/api-client';

const ApiContext = createContext<WebApi | null>(null);

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Hata cevapları (4xx) tekrar denense de değişmez; yalnızca bir kez tekrar denenir (ör. ağ kopması).
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
      // Bir değişikliği kendiliğinden tekrar göndermek, kullanıcının bilmediği ikinci bir işlem demektir.
      mutations: { retry: false },
    },
  });
}

/** Şirketten bağımsız istemci ve sorgu önbelleği: şirket listesi, oturum, sağlık, şirket kurma, davetle katılma. */
export function ApiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(createQueryClient);
  const [api] = useState(() => createWebApi(null));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

/**
 * Aktif şirkete bağlı istemci ve ona ait ayrı sorgu önbelleği. Çağıran key={organizationId} ile kullanır: şirket
 * değişince ikisi de baştan kurulur. Sorgu anahtarları başlıkları içermediği için tek önbellekte bir şirketin
 * cevabı ötekinin ekranında görünebilirdi; ayrı önbellek bunu yapı gereği imkânsız kılar.
 */
export function OrganizationApiProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}): JSX.Element {
  const [queryClient] = useState(createQueryClient);
  const [api] = useState(() => createWebApi(organizationId));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

/** En yakın sağlayıcının istemcisi: aktif şirket varsa onun adına, yoksa şirketten bağımsız. */
export function useApi(): WebApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error('useApi yalnızca ApiProvider içinde kullanılabilir.');
  }
  return api;
}
