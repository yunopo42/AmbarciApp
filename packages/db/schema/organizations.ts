import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import { createdAtOnly, organizationRole, timestamps } from './common.ts';
import { adminCanRead, memberCanRead } from './rls.ts';

/** Şirkete özel ayarlar (onay eşiği, günlük AI limiti gibi); alanlar ilgili haftalarda Zod şemasıyla tanımlanır. */
export type OrganizationSettings = Record<string, unknown>;

/** Kök kiracı. Diğer tüm şirket verisi organization_id ile buna bağlanır. */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    settings: jsonb('settings').$type<OrganizationSettings>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    check('organizations_name_not_blank', sql`length(trim(${t.name})) > 0`),
    memberCanRead('organizations', t.id),
  ],
).enableRLS();

/**
 * Kullanıcının şirketteki üyeliği ve rolü. Kullanıcının kendisi Supabase Auth'ta (auth.users) tutulur;
 * ayrı bir kullanıcı tablosu açılmaz. Bir kullanıcı birden fazla şirkete üye olabilir.
 */
export const organizationUsers = pgTable(
  'organization_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Hesap silinince (KVKK) üyelik de silinir.
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: organizationRole('role').notNull().default('EMPLOYEE'),
    // Üyelik silinmez, pasife alınır; pasif üye hiçbir şirket verisini göremez.
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('organization_users_org_user_key').on(t.organizationId, t.userId),
    // Bileşik yabancı anahtarların hedefi: depo yetkisi aynı şirketin üyesine bağlanabilsin.
    unique('organization_users_org_id_key').on(t.organizationId, t.id),
    // "Bu kullanıcı hangi şirketlerde?" sorgusu her istekte ve her RLS kontrolünde çalışır.
    index('organization_users_user_id_idx').on(t.userId),
    memberCanRead('organization_users', t.organizationId),
  ],
).enableRLS();

/** Tek kullanımlık, süreli davet kodu. Kodla katılan kullanıcı davetteki rolle üye olur. */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Kullanıcı katılırken şirketi bilmez, yalnızca kodu girer; bu yüzden kod tüm sistemde benzersizdir.
    code: text('code').notNull().unique('invitations_code_key'),
    role: organizationRole('role').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: uuid('used_by').references(() => authUsers.id, { onDelete: 'set null' }),
    ...createdAtOnly,
  },
  (t) => [
    index('invitations_organization_id_idx').on(t.organizationId),
    // Kullanıcı hesabı silinince bu alanlar boşaltılır; indeks olmadan tablo baştan sona taranır.
    index('invitations_created_by_idx').on(t.createdBy),
    index('invitations_used_by_idx').on(t.usedBy),
    // Kısa kod tahmin edilebilir.
    check('invitations_code_min_length', sql`char_length(${t.code}) >= 8`),
    // Kullanan kişi kayıtlıysa kullanılma zamanı da kayıtlıdır. (Kullanan hesabını silerse used_by
    // boşalır ama used_at kalır; kod yine kullanılmış sayılır.)
    check('invitations_used_by_requires_used_at', sql`${t.usedBy} is null or ${t.usedAt} is not null`),
    adminCanRead('invitations', t.organizationId),
  ],
).enableRLS();
