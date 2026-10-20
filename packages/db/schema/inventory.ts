import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, unique, uuid } from 'drizzle-orm/pg-core';

import { products } from './catalog.ts';
import { timestamps } from './common.ts';
import { memberCanRead } from './rls.ts';
import { warehouses } from './warehouses.ts';

/**
 * Depo bazında anlık stok ve hareketli ortalama birim maliyet. Satırlar yalnızca stok uygulama
 * transaction'ında (onay uç noktası, 3. hafta) değişir; istemciler bu tabloya yazamaz.
 */
export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    // Ana birimde miktar.
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('0'),
    // Birim maliyet kuruşun altına inebilir (1000 adetlik kutu 35 TL ise adet 0,035 TL); 4 ondalık tutulur.
    averageCost: numeric('average_cost', { precision: 14, scale: 4 }).notNull().default('0'),
    ...timestamps,
  },
  (t) => [
    unique('inventory_org_warehouse_product_key').on(t.organizationId, t.warehouseId, t.productId),
    // "Bu ürün hangi depolarda?" sorgusu için (yukarıdaki kısıt depo ile başladığından bunu karşılamaz).
    index('inventory_org_product_idx').on(t.organizationId, t.productId),
    foreignKey({
      name: 'inventory_warehouse_fk',
      columns: [t.organizationId, t.warehouseId],
      foreignColumns: [warehouses.organizationId, warehouses.id],
    }),
    foreignKey({
      name: 'inventory_product_fk',
      columns: [t.organizationId, t.productId],
      foreignColumns: [products.organizationId, products.id],
    }),
    // Son savunma hattı: uygulama hatası olsa bile stok eksiye düşemez.
    check('inventory_quantity_non_negative', sql`${t.quantity} >= 0`),
    check('inventory_average_cost_non_negative', sql`${t.averageCost} >= 0`),
    memberCanRead('inventory', t.organizationId),
  ],
).enableRLS();
