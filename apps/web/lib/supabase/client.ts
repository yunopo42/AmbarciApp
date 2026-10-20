import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from './config';

/** Tarayıcıdaki Supabase istemcisi. Oturum çerezlerde tutulur; proxy.ts ve sunucu bileşenleri aynı çerezleri okur. */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
