import { sql } from 'drizzle-orm';
import { pgPolicy } from 'drizzle-orm/pg-core';
import type { AnyPgColumn, PgPolicy } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

// RLS politikaları yalnızca Supabase Data API'den gelen istekleri (anon ve authenticated roller) etkiler.
// API tablo sahibi postgres kullanıcısıyla bağlandığı için politikalardan etkilenmez; API'deki şirket
// izolasyonu her sorgudaki organization_id filtresinden gelir. RLS ikinci savunma hattıdır.
//
// Yalnızca okuma politikası vardır. Yazma politikası bilerek yoktur ve istemci rollerinin yazma yetkisi
// 0001_rls_helpers.sql ile geri alınmıştır: veri yalnızca API'den değişir.
//
// Yardımcı fonksiyonlar (private şeması) 0001_rls_helpers.sql içinde tanımlıdır. "(select ...)" kalıbı,
// fonksiyonun her satır için değil sorgu başına bir kez çalışmasını sağlar.

/** Oturumdaki kullanıcı, satırın şirketinin aktif üyesiyse satırı okuyabilir. */
export function memberCanRead(table: string, organizationId: AnyPgColumn): PgPolicy {
  return pgPolicy(`${table}_select_member`, {
    for: 'select',
    to: authenticatedRole,
    using: sql`${organizationId} in (select private.user_organization_ids())`,
  });
}

/** Yalnızca şirketin aktif yöneticileri okuyabilir (örn. davet kodları). */
export function adminCanRead(table: string, organizationId: AnyPgColumn): PgPolicy {
  return pgPolicy(`${table}_select_admin`, {
    for: 'select',
    to: authenticatedRole,
    using: sql`${organizationId} in (select private.admin_organization_ids())`,
  });
}
