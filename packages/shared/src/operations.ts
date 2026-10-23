import { z } from 'zod';

/** Onay isteğinin tekrarını tanıyan başlık. Aynı anahtarla gelen ikinci istek aynı cevabı alır, stok yeniden değişmez. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

export const operationTypeSchema = z.enum(['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', 'OPENING', 'REVERSAL']);
export type OperationType = z.infer<typeof operationTypeSchema>;

export const operationStatusSchema = z.enum([
  'RECEIVED',
  'NEEDS_CLARIFICATION',
  'PENDING_CONFIRMATION',
  'APPLIED',
  'REVERSED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
]);
export type OperationStatus = z.infer<typeof operationStatusSchema>;

export const actionSourceSchema = z.enum(['SCREEN', 'CHAT', 'DOCUMENT', 'IMPORT', 'SYSTEM']);
export type ActionSource = z.infer<typeof actionSourceSchema>;

export const movementTypeSchema = z.enum([
  'IN',
  'OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COUNT_SURPLUS',
  'COUNT_SHORTAGE',
  'WASTE',
  'REVERSAL',
]);
export type MovementType = z.infer<typeof movementTypeSchema>;

// Miktar ve maliyet metin olarak taşınır ve sayıya çevrilmez (ADR-003); ondalık ayırıcı noktadır.
// Hane sınırları veritabanı kolonlarıyla aynıdır: NUMERIC(14,3) en fazla 11 tam, NUMERIC(14,4) en fazla 10 tam hane.
const ZERO = /^0+(\.0+)?$/;

export const quantitySchema = z
  .string()
  .regex(/^\d{1,11}(\.\d{1,3})?$/, 'Miktar en fazla 11 tam ve 3 ondalık haneli, eksi olmayan bir sayı olmalı (ör. 12.5).');

export const unitCostSchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,4})?$/, 'Birim maliyet en fazla 10 tam ve 4 ondalık haneli, eksi olmayan bir sayı olmalı.');

/** Metin olarak verilen miktarın sıfır olup olmadığı (sayıya çevirmeden). */
export function isZeroQuantity(value: string): boolean {
  return ZERO.test(value);
}

// Ekrandan açılabilen işlem türleri. Ters kayıt (REVERSAL) 5. haftada kendi uç noktasıyla gelir.
export const creatableOperationTypeSchema = operationTypeSchema.exclude(['REVERSAL']);
export type CreatableOperationType = z.infer<typeof creatableOperationTypeSchema>;

export const operationItemInputSchema = z.object({
  productId: z.uuid(),
  /** Girişte malın girdiği; çıkış, fire ve sayımda ilgili depo; transferde malın çıktığı depo. */
  warehouseId: z.uuid(),
  /** Yalnızca transferde: malın gittiği depo. */
  targetWarehouseId: z.uuid().optional(),
  /** Girilen birimde miktar. Sayımda sayılan miktardır ve 0 olabilir. */
  quantity: quantitySchema,
  /** Girilen birim (koli, makara). Verilmezse ürünün ana birimi. */
  unit: z.string().trim().min(1).max(40).optional(),
  /** Yalnızca giriş ve açılışta: girilen birim başına maliyet. */
  unitCost: unitCostSchema.optional(),
});
export type OperationItemInput = z.infer<typeof operationItemInputSchema>;

/** POST /v1/operations: işlem onay bekleyen (PENDING_CONFIRMATION) olarak açılır; stok değişmez. */
export const createOperationSchema = z
  .object({
    type: creatableOperationTypeSchema,
    /** Girişte tedarikçi, çıkışta müşteri. */
    partyId: z.uuid().optional(),
    note: z.string().trim().max(500).optional(),
    items: z.array(operationItemInputSchema).min(1).max(100),
  })
  .superRefine((operation, context) => {
    const { type } = operation;
    const takesCost = type === 'STOCK_IN' || type === 'OPENING';
    if (operation.partyId && type !== 'STOCK_IN' && type !== 'STOCK_OUT') {
      context.addIssue({ code: 'custom', path: ['partyId'], message: 'Cari yalnızca giriş ve çıkışta seçilebilir.' });
    }
    const counted = new Set<string>();
    operation.items.forEach((item, index) => {
      const path = (field: string): (string | number)[] => ['items', index, field];
      if (type === 'TRANSFER') {
        if (!item.targetWarehouseId) {
          context.addIssue({ code: 'custom', path: path('targetWarehouseId'), message: 'Transferde hedef depo zorunlu.' });
        } else if (item.targetWarehouseId.toLowerCase() === item.warehouseId.toLowerCase()) {
          context.addIssue({ code: 'custom', path: path('targetWarehouseId'), message: 'Hedef depo, çıkış deposundan farklı olmalı.' });
        }
      } else if (item.targetWarehouseId) {
        context.addIssue({ code: 'custom', path: path('targetWarehouseId'), message: 'Hedef depo yalnızca transferde girilir.' });
      }
      if (type !== 'COUNT' && isZeroQuantity(item.quantity)) {
        context.addIssue({ code: 'custom', path: path('quantity'), message: 'Miktar sıfırdan büyük olmalı.' });
      }
      if (item.unitCost !== undefined && !takesCost) {
        context.addIssue({ code: 'custom', path: path('unitCost'), message: 'Birim maliyet yalnızca giriş ve açılışta girilir.' });
      }
      if (type === 'COUNT') {
        // Aynı ürün aynı depoda iki kez sayılırsa hangi sonucun geçerli olduğu belirsizleşir.
        const key = `${item.productId.toLowerCase()}:${item.warehouseId.toLowerCase()}`;
        if (counted.has(key)) {
          context.addIssue({ code: 'custom', path: path('productId'), message: 'Bu ürün bu depoda zaten sayıldı.' });
        }
        counted.add(key);
      }
    });
  });
export type CreateOperationInput = z.infer<typeof createOperationSchema>;

/** POST /v1/operations/{id}/confirm. Kullanıcının gördüğü sürüm; işlem bu arada düzenlendiyse onay reddedilir. */
export const confirmOperationSchema = z.object({
  version: z.number().int().min(1),
});
export type ConfirmOperationInput = z.infer<typeof confirmOperationSchema>;

/** Idempotency-Key: istemcinin her onay denemesi için ürettiği anahtar (önerilen: UUID). */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,200}$/, 'Idempotency-Key 8–200 karakterlik harf, rakam ya da _ . : - içermeli.');

export const operationItemSchema = z.object({
  lineNo: z.number().int(),
  productId: z.uuid(),
  warehouseId: z.uuid(),
  targetWarehouseId: z.uuid().nullable(),
  quantity: z.string(),
  unit: z.string().nullable(),
  unitCost: z.string().nullable(),
});
export type OperationItem = z.infer<typeof operationItemSchema>;

export const operationSchema = z.object({
  id: z.uuid(),
  type: operationTypeSchema,
  status: operationStatusSchema,
  source: actionSourceSchema,
  version: z.number().int(),
  partyId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  appliedBy: z.uuid().nullable(),
  appliedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  items: z.array(operationItemSchema),
});
export type Operation = z.infer<typeof operationSchema>;

/** Onayla yazılan stok hareketi; miktar ana birimde ve işaretli (giriş +, çıkış −). */
export const movementSchema = z.object({
  lineNo: z.number().int(),
  warehouseId: z.uuid(),
  productId: z.uuid(),
  type: movementTypeSchema,
  quantityChange: z.string(),
  unitCost: z.string(),
  quantityAfter: z.string(),
  averageCostAfter: z.string(),
});
export type Movement = z.infer<typeof movementSchema>;

export const confirmOperationResultSchema = z.object({
  operation: operationSchema,
  movements: z.array(movementSchema),
});
export type ConfirmOperationResult = z.infer<typeof confirmOperationResultSchema>;
