import { pgEnum, timestamp } from 'drizzle-orm/pg-core';

// Zamanlar saat dilimli tutulur (timestamptz); sunucu ve istemci farklı bölgelerde olsa da kayma olmaz.
// Ortak kolonlar tablolara yayılarak (...timestamps) kullanılır.
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Uygulama üzerinden yapılan güncellemelerde Drizzle tarafından yenilenir.
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Yalnızca eklenen, güncellenmeyen kayıtlar için.
export const createdAtOnly = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

// Sabit değer listeleri. Yeni değer eklemek bir migration gerektirir; bu, listenin
// kod ile veritabanı arasında sessizce ayrışmasını önler.
export const organizationRole = pgEnum('organization_role', ['ADMIN', 'EMPLOYEE']);
export const warehouseType = pgEnum('warehouse_type', ['WAREHOUSE', 'BRANCH', 'VEHICLE']);
export const partyType = pgEnum('party_type', ['SUPPLIER', 'CUSTOMER']);
export const aliasSource = pgEnum('alias_source', ['MANUAL', 'LEARNED']);
