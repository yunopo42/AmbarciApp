import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, smallint, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { products } from './catalog.ts';
import { createdAtOnly, movementType, timestamps } from './common.ts';
import { operationItems } from './operations.ts';
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

/**
 * Stok hareketleri: stoğu değiştiren her şeyin kaydı. Yalnızca onay transaction'ında eklenir; güncellenmez ve
 * silinmez (istemcilerin yazma yetkisi yok, API'de de güncelleme/silme yolu yok). quantity_change işaretlidir
 * (giriş +, çıkış −); bir depodaki ürünün hareketlerinin toplamı inventory.quantity'ye eşittir.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    type: movementType('type').notNull(),
    // Ana birimde, işaretli değişim (3 koli × 12 = +36 adet).
    quantityChange: numeric('quantity_change', { precision: 14, scale: 3 }).notNull(),
    // Onay anındaki çevrim katsayısı (ana birimde girildiyse 1). Katsayı sonradan değişse de hareketin nasıl
    // hesaplandığı kayıtta kalır.
    unitFactor: numeric('unit_factor', { precision: 14, scale: 6 }).notNull(),
    // Ana birim başına maliyet: girişte alış maliyeti, çıkışta o anki ortalama. Ters kayıt bu maliyetle yazılır.
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    // Hareketten sonraki stok ve ortalama maliyet: stok kartındaki bakiye satırı.
    quantityAfter: numeric('quantity_after', { precision: 14, scale: 3 }).notNull(),
    averageCostAfter: numeric('average_cost_after', { precision: 14, scale: 4 }).notNull(),
    // now() transaction'ın başladığı anı verir; kilit bekleyen bir transaction daha önce başlamış olabilir.
    // clock_timestamp() eklemenin gerçek anını verir; aynı stok satırının hareketleri kilit sırasıyla sıralanır.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  },
  (t) => [
    // Tekilleştirme: bir kalem bir depodaki stoğu en fazla bir kez değiştirir. Aynı işlem ikinci kez uygulanmaya
    // çalışılırsa hareket burada reddedilir. Transfer kaleminin iki hareketi vardır (çıkan ve giren depo).
    unique('inventory_movements_line_warehouse_key').on(t.organizationId, t.operationId, t.lineNo, t.warehouseId),
    foreignKey({
      name: 'inventory_movements_item_fk',
      columns: [t.organizationId, t.operationId, t.lineNo],
      foreignColumns: [operationItems.organizationId, operationItems.operationId, operationItems.lineNo],
    }),
    // Hareket bir stok satırına bağlıdır: depo ve ürün aynı şirketten, satır önceden var.
    foreignKey({
      name: 'inventory_movements_inventory_fk',
      columns: [t.organizationId, t.warehouseId, t.productId],
      foreignColumns: [inventory.organizationId, inventory.warehouseId, inventory.productId],
    }),
    // Stok kartı (depo + ürün) ve ürünün bütün depolardaki son hareketleri.
    index('inventory_movements_org_warehouse_product_idx').on(
      t.organizationId,
      t.warehouseId,
      t.productId,
      t.createdAt,
    ),
    index('inventory_movements_org_product_idx').on(t.organizationId, t.productId, t.createdAt),
    // Hareket türü ile değişimin yönü uyumlu olmak zorunda; sıfır miktarlı hareket yazılamaz.
    check(
      'inventory_movements_direction',
      sql`(${t.type} in ('IN', 'TRANSFER_IN', 'COUNT_SURPLUS') and ${t.quantityChange} > 0)
        or (${t.type} in ('OUT', 'TRANSFER_OUT', 'COUNT_SHORTAGE', 'WASTE') and ${t.quantityChange} < 0)
        or (${t.type} = 'REVERSAL' and ${t.quantityChange} <> 0)`,
    ),
    check('inventory_movements_unit_factor_positive', sql`${t.unitFactor} > 0`),
    check('inventory_movements_unit_cost_non_negative', sql`${t.unitCost} >= 0`),
    check('inventory_movements_quantity_after_non_negative', sql`${t.quantityAfter} >= 0`),
    check('inventory_movements_average_cost_after_non_negative', sql`${t.averageCostAfter} >= 0`),
    memberCanRead('inventory_movements', t.organizationId),
  ],
).enableRLS();

/**
 * Sayım sonuçları: onay anında kilitli stok satırından okunan sistem miktarı ve sayılan miktar (ana birimde).
 * Fark varsa aynı transaction'da COUNT_SURPLUS veya COUNT_SHORTAGE hareketi yazılır; fark yoksa yalnızca bu
 * kayıt kalır ve "sayıldı, tuttu" bilgisi kaybolmaz.
 */
export const stockCounts = pgTable(
  'stock_counts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    systemQuantity: numeric('system_quantity', { precision: 14, scale: 3 }).notNull(),
    countedQuantity: numeric('counted_quantity', { precision: 14, scale: 3 }).notNull(),
    // Veritabanı hesaplar ve saklar; elle yazılamaz, bu yüzden iki miktarla her zaman tutarlıdır.
    difference: numeric('difference', { precision: 14, scale: 3 }).generatedAlwaysAs(
      sql`"counted_quantity" - "system_quantity"`,
    ),
    ...createdAtOnly,
  },
  (t) => [
    // Bir sayım kaleminin tek sonucu olur.
    unique('stock_counts_org_operation_line_key').on(t.organizationId, t.operationId, t.lineNo),
    foreignKey({
      name: 'stock_counts_item_fk',
      columns: [t.organizationId, t.operationId, t.lineNo],
      foreignColumns: [operationItems.organizationId, operationItems.operationId, operationItems.lineNo],
    }),
    foreignKey({
      name: 'stock_counts_inventory_fk',
      columns: [t.organizationId, t.warehouseId, t.productId],
      foreignColumns: [inventory.organizationId, inventory.warehouseId, inventory.productId],
    }),
    index('stock_counts_org_warehouse_product_idx').on(t.organizationId, t.warehouseId, t.productId),
    check('stock_counts_system_quantity_non_negative', sql`${t.systemQuantity} >= 0`),
    check('stock_counts_counted_quantity_non_negative', sql`${t.countedQuantity} >= 0`),
    memberCanRead('stock_counts', t.organizationId),
  ],
).enableRLS();
