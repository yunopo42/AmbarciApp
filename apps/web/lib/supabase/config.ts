export interface SupabasePublicConfig {
  url: string;
  anonKey: string;
}

/**
 * Supabase adresi ve anon anahtarı. İkisi de herkese açık değerlerdir ve tarayıcı paketine gömülür;
 * veriyi RLS ve API korur. Service role anahtarı web paketine asla girmez.
 */
export function getSupabaseConfig(): SupabasePublicConfig {
  // Next.js NEXT_PUBLIC_ değişkenlerini yalnızca bu yazımla (process.env.ADI) pakete gömer.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ve NEXT_PUBLIC_SUPABASE_ANON_KEY tanımlı olmalı.');
  }
  return { url, anonKey };
}
