import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { aliasSource, createdAtOnly, partyType, timestamps } from './common.ts';
import { organizations } from './organizations.ts';
import { memberCanRead } from './rls.ts';

/**
 * Stok kartı. Hareketi olan ürün silinmez, pasife alınır. Stok her zaman ana birimde (base_unit) tutulur.
 * Miktarlar NUMERIC olduğu için Drizzle bunları JS'e metin olarak verir; JS number'a çevrilip hesap yapılmaz.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    sku: text('sku').notNull(),
    barcode: text('barcode'),
    name: text('name').notNull(),
    // Ana birim: adet, metre, kg gibi. Diğer birimler product_units'te bu birime çevrilir.
    baseUnit: text('base_unit').notNull(),
    // Kritik stok eşiği (ana birimde); boşsa kritik stok bildirimi yapılmaz.
    minStock: numeric('min_stock', { precision: 14, scale: 3 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('products_org_sku_key').on(t.organizationId, t.sku),
    // Boş barkod birden fazla üründe olabilir (PostgreSQL'de NULL değerler benzersizlik kısıtına takılmaz).
    unique('products_org_barcode_key').on(t.organizationId, t.barcode),
    unique('products_org_id_key').on(t.organizationId, t.id),
    check('products_sku_not_blank', sql`length(trim(${t.sku})) > 0`),
    check('products_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check('products_min_stock_non_negative', sql`${t.minStock} >= 0`),
    memberCanRead('products', t.organizationId),
  ],
).enableRLS();

/**
 * Ana birim dışındaki birimler: 1 koli = 12 adet ise factor 12. Çevrim yalnızca çarpmayla yapılır
 * (miktar × katsayı) ve sonuç tek noktada NUMERIC(14,3)'e yuvarlanır.
 */
export const productUnits = pgTable(
  'product_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    productId: uuid('product_id').notNull(),
    unit: text('unit').notNull(),
    factor: numeric('factor', { precision: 14, scale: 6 }).notNull(),
    barcode: text('barcode'),
    ...timestamps,
  },
  (t) => [
    // Bileşik anahtar: birim yalnızca aynı şirketin ürününe bağlanabilir.
    foreignKey({
      name: 'product_units_product_fk',
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    unique('product_units_product_unit_key').on(t.organizationId, t.productId, t.unit),
    unique('product_units_org_barcode_key').on(t.organizationId, t.barcode),
    check('product_units_unit_not_blank', sql`length(trim(${t.unit})) > 0`),
    check('product_units_factor_positive', sql`${t.factor} > 0`),
    memberCanRead('product_units', t.organizationId),
  ],
).enableRLS();

/**
 * Ürünün sahada kullanılan diğer adları ("üçlü priz", "grup priz"). Asistan ürünü bu adlarla da bulur.
 * Benzerlik araması için pg_trgm GIN indeksi 4. haftada eklenecek.
 */
export const productAliases = pgTable(
  'product_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    productId: uuid('product_id').notNull(),
    alias: text('alias').notNull(),
    source: aliasSource('source').notNull().default('MANUAL'),
    ...createdAtOnly,
  },
  (t) => [
    foreignKey({
      name: 'product_aliases_product_fk',
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    // Aynı ad iki farklı ürüne verilebilir; o durumda asistan kullanıcıya hangisi olduğunu sorar.
    unique('product_aliases_product_alias_key').on(t.organizationId, t.productId, t.alias),
    index('product_aliases_org_alias_idx').on(t.organizationId, t.alias),
    check('product_aliases_alias_not_blank', sql`length(trim(${t.alias})) > 0`),
    memberCanRead('product_aliases', t.organizationId),
  ],
).enableRLS();

/** Cari kart: tedarikçi veya müşteri. Borç-alacak takibi yapılmaz. */
export const parties = pgTable(
  'parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    type: partyType('type').notNull(),
    // VKN (10 hane) veya TCKN (11 hane), isteğe bağlı. TCKN kişisel veridir; loglanmaz.
    taxId: text('tax_id'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('parties_org_tax_id_key').on(t.organizationId, t.taxId),
    index('parties_org_name_idx').on(t.organizationId, t.name),
    check('parties_name_not_blank', sql`length(trim(${t.name})) > 0`),
    check('parties_tax_id_format', sql`${t.taxId} ~ '^[0-9]{10,11}$'`),
    memberCanRead('parties', t.organizationId),
  ],
).enableRLS();
