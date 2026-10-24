import { z } from 'zod';

import { pageQuery } from './catalog.js';
import { warehouseSchema } from './inventory.js';
import { movementTypeSchema, operationStatusSchema, operationTypeSchema } from './operations.js';

// Stoğu okuyan uçlar: işlem önizlemesi, depo bazında stok listesi ve ürünün hareket geçmişi. Miktar ve maliyet
// metin olarak taşınır ve sayıya çevrilmez (ADR-003); hesaplar SQL'de yapılır.

const warehouseRefSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

/** Bir deponun stoğu: onaydan önce ve işlem onaylanırsa sonra (ana birimde). */
export const stockEffectSchema = z.object({
  before: z.string(),
  after: z.string(),
  /** Stok bu kalemi karşılıyor mu (sonraki miktar eksiye düşmüyor). Girişte her zaman true. */
  sufficient: z.boolean(),
});
export type StockEffect = z.infer<typeof stockEffectSchema>;

export const operationPreviewLineSchema = z.object({
  lineNo: z.number().int(),
  productId: z.uuid(),
  sku: z.string(),
  productName: z.string(),
  baseUnit: z.string(),
  /** Girilen miktar ve birim; birim boşsa ana birim. */
  quantity: z.string(),
  unit: z.string().nullable(),
  /** Ana birime çevrilmiş miktar (sayımda sayılan miktar). */
  baseQuantity: z.string(),
  /** Girilen birim başına maliyet (yalnızca giriş ve açılış). */
  unitCost: z.string().nullable(),
  warehouse: warehouseRefSchema,
  /** Yalnızca transferde: malın gittiği depo. */
  targetWarehouse: warehouseRefSchema.nullable(),
  /** Kaynak deponun stoğu. Yalnızca onay bekleyen işlemde hesaplanır; diğer durumlarda null. */
  stock: stockEffectSchema.nullable(),
  /** Transferde hedef deponun stoğu. */
  targetStock: stockEffectSchema.nullable(),
});
export type OperationPreviewLine = z.infer<typeof operationPreviewLineSchema>;

/**
 * GET /v1/operations/{id}/preview: onay ekranının özeti. Stoğun önceki ve sonraki hâli sunucuda, o anki stoktan
 * hesaplanır; kilit alınmaz. Onay anında stok yeniden okunur: arada başka bir işlem onaylandıysa sonuç farklı olabilir.
 */
export const operationPreviewSchema = z.object({
  operationId: z.uuid(),
  type: operationTypeSchema,
  status: operationStatusSchema,
  version: z.number().int(),
  partyId: z.uuid().nullable(),
  partyName: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  lines: z.array(operationPreviewLineSchema),
});
export type OperationPreview = z.infer<typeof operationPreviewSchema>;

/** GET /v1/warehouses/{id}/stock: depodaki ürünler; ad, SKU, barkod ya da alternatif adda arama. */
export const stockListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  ...pageQuery,
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

export const stockLevelSchema = z.object({
  productId: z.uuid(),
  sku: z.string(),
  name: z.string(),
  baseUnit: z.string(),
  minStock: z.string().nullable(),
  /** Ana birimde; depoda hiç hareketi olmayan ürün için "0". */
  quantity: z.string(),
  averageCost: z.string(),
  /** Kritik stok eşiği tanımlı ve miktar eşiğin altında. Karşılaştırma SQL'de yapılır. */
  belowMinimum: z.boolean(),
});
export type StockLevel = z.infer<typeof stockLevelSchema>;

export const warehouseStockSchema = z.object({
  warehouse: warehouseSchema,
  items: z.array(stockLevelSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type WarehouseStock = z.infer<typeof warehouseStockSchema>;

/** Ürünün bir depodaki stoğu (GET /v1/products/{id}/stock). */
export const productWarehouseStockSchema = z.object({
  warehouse: warehouseSchema,
  /** Ana birimde; depoda hiç hareketi olmayan ürün için "0". */
  quantity: z.string(),
  averageCost: z.string(),
  belowMinimum: z.boolean(),
});
export type ProductWarehouseStock = z.infer<typeof productWarehouseStockSchema>;

/**
 * GET /v1/products/{id}/stock: ürünün depolara göre stoğu ve toplamı. Yönetici bütün depoları, çalışan yalnızca
 * yetkili olduğu depoları görür; toplam da yalnızca görünen depolarındır. Pasif depo yalnızca stoğu varsa listelenir.
 */
export const productStockSchema = z.object({
  productId: z.uuid(),
  baseUnit: z.string(),
  minStock: z.string().nullable(),
  /** Görünen depoların toplamı (SQL'de toplanır). */
  total: z.string(),
  warehouses: z.array(productWarehouseStockSchema),
});
export type ProductStock = z.infer<typeof productStockSchema>;

/** GET /v1/products/{id}/movements: en yeni hareket önce; isteğe bağlı depo süzgeci. */
export const productMovementQuerySchema = z.object({
  warehouseId: z.uuid().optional(),
  ...pageQuery,
});
export type ProductMovementQuery = z.infer<typeof productMovementQuerySchema>;

export const productMovementSchema = z.object({
  id: z.uuid(),
  operationId: z.uuid(),
  lineNo: z.number().int(),
  createdAt: z.iso.datetime({ offset: true }),
  warehouse: warehouseRefSchema,
  type: movementTypeSchema,
  /** Ana birimde, işaretli: giriş +, çıkış −. */
  quantityChange: z.string(),
  unitCost: z.string(),
  quantityAfter: z.string(),
  averageCostAfter: z.string(),
});
export type ProductMovement = z.infer<typeof productMovementSchema>;

export const productMovementListSchema = z.object({
  items: z.array(productMovementSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProductMovementList = z.infer<typeof productMovementListSchema>;
