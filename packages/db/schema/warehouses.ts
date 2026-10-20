import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';

import { createdAtOnly, timestamps, warehouseType } from './common.ts';
import { organizations, organizationUsers } from './organizations.ts';
import { memberCanRead } from './rls.ts';

/** Depo, şube veya araç deposu. Silinmez, pasife alınır. */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    type: warehouseType('type').notNull().default('WAREHOUSE'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // Asistan depoyu adıyla bulur ("ana depoya 10 koli"); aynı şirkette iki aynı adlı depo belirsizlik yaratır.
    unique('warehouses_org_name_key').on(t.organizationId, t.name),
    unique('warehouses_org_id_key').on(t.organizationId, t.id),
    check('warehouses_name_not_blank', sql`length(trim(${t.name})) > 0`),
    memberCanRead('warehouses', t.organizationId),
  ],
).enableRLS();

/**
 * Çalışanın işlem yapabileceği depolar. Yöneticiler (ADMIN) tüm depolarda yetkilidir; bu tablo
 * çalışanlar içindir ve kural API'de uygulanır.
 */
export const userWarehouseAccess = pgTable(
  'user_warehouse_access',
  {
    organizationId: uuid('organization_id').notNull(),
    organizationUserId: uuid('organization_user_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    ...createdAtOnly,
  },
  (t) => [
    // Şirketle başlar: üye yabancı anahtarını da kapsar, ayrı indeks gerekmez.
    primaryKey({
      name: 'user_warehouse_access_pkey',
      columns: [t.organizationId, t.organizationUserId, t.warehouseId],
    }),
    // Bileşik anahtarlar üye ile deponun aynı şirkete ait olmasını veritabanında garanti eder.
    foreignKey({
      name: 'user_warehouse_access_member_fk',
      columns: [t.organizationId, t.organizationUserId],
      foreignColumns: [organizationUsers.organizationId, organizationUsers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_warehouse_access_warehouse_fk',
      columns: [t.organizationId, t.warehouseId],
      foreignColumns: [warehouses.organizationId, warehouses.id],
    }),
    index('user_warehouse_access_warehouse_idx').on(t.organizationId, t.warehouseId),
    memberCanRead('user_warehouse_access', t.organizationId),
  ],
).enableRLS();
