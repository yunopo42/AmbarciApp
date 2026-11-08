import { z } from 'zod';

import { partyTypeSchema } from './catalog.js';
import { quantitySchema, unitCostSchema } from './operations.js';

// Asistanın okuma araçlarının girdileri. Modele gönderilen strict JSON şeması bu Zod şemalarından üretilir; model
// girdisi aynı şemayla sunucuda yeniden doğrulanır. Alan adları modele dönük olduğu için snake_case (2. hafta
// denemesindeki araç tanımlarıyla aynı). Şirket ve kullanıcı kimliği hiçbir aracın girdisinde yoktur: oturumdan gelir
// (mimari değişmez 5); strictObject fazladan alanı (ör. organization_id) reddeder.

const productId = z
  .uuid({ error: 'product_id geçerli bir ürün kimliği değil; ürünü önce search_products ile bulun.' })
  .describe('search_products sonucundaki product_id.');

const warehouseId = z
  .uuid({ error: 'warehouse_id geçerli bir depo kimliği değil; depoyu önce list_warehouses ile bulun.' })
  .describe('list_warehouses sonucundaki warehouse_id.');

export const searchProductsToolInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1, 'Aranacak ürün adı boş olamaz.')
    .max(100, 'Aranacak metin en fazla 100 karakter olabilir.')
    .describe("Aranacak ürün adı, ölçü ve özellikleriyle; ör. 'NYM kablo 3x2,5'. Stok kodu ya da barkod da olabilir."),
});
export type SearchProductsToolInput = z.infer<typeof searchProductsToolInputSchema>;

export const getStockToolInputSchema = z.strictObject({
  product_id: productId,
  warehouse_id: warehouseId.optional().describe('İsteğe bağlı; verilmezse kullanıcının görebildiği bütün depolar.'),
});
export type GetStockToolInput = z.infer<typeof getStockToolInputSchema>;

export const listRecentMovementsToolInputSchema = z.strictObject({
  product_id: productId,
  warehouse_id: warehouseId.optional().describe('İsteğe bağlı; verilmezse kullanıcının görebildiği bütün depolar.'),
  limit: z
    .number()
    .int('limit tam sayı olmalı.')
    .min(1, 'limit en az 1 olmalı.')
    .max(20, 'limit en fazla 20 olabilir.')
    .optional()
    .describe('Kaç hareket getirileceği, 1–20; verilmezse 10.'),
});
export type ListRecentMovementsToolInput = z.infer<typeof listRecentMovementsToolInputSchema>;

export const listWarehousesToolInputSchema = z.strictObject({});
export type ListWarehousesToolInput = z.infer<typeof listWarehousesToolInputSchema>;

export const searchPartiesToolInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1, 'Aranacak cari adı boş olamaz.')
    .max(100, 'Aranacak metin en fazla 100 karakter olabilir.')
    .describe("Tedarikçi ya da müşterinin adı (ör. 'Yıldız Yapı'); vergi numarasının başı da olabilir."),
  type: partyTypeSchema
    .optional()
    .describe('İsteğe bağlı: girişte tedarikçi (SUPPLIER), çıkışta müşteri (CUSTOMER).'),
});
export type SearchPartiesToolInput = z.infer<typeof searchPartiesToolInputSchema>;

// Öneri araçlarının girdileri (5. hafta, #74). Öneri araçları stoğa yazmaz: işlemi onay bekleyen olarak açar ya da
// sohbette açılmış öneriyi düzenler; stok yalnızca kullanıcı kartta "Onayla"ya basınca değişir (mimari değişmez 1, 2).
// Girdiler sunucuda işlem şemasına (createOperationSchema) çevrilip aynı kurallarla yeniden doğrulanır.

/** Bir öneride en fazla bu kadar kalem; sohbette daha uzun liste kartta okunmaz. */
export const PROPOSAL_MAX_LINES = 20;

const operationId = z
  .uuid({ error: 'operation_id geçerli bir işlem kimliği değil; düzenlenecek önerinin operation_id değerini kullan.' })
  .describe(
    'Yalnızca bu sohbette önerdiğin ve kullanıcının düzeltmek istediği öneriyi düzenlerken: o önerinin operation_id değeri. Yeni öneride verme.',
  );

const proposalQuantity = quantitySchema.describe(
  "Kullanıcının söylediği birimdeki miktar, metin olarak; ondalık ayırıcı nokta (ör. '2', '12.5').",
);

const proposalUnit = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .describe("Kullanıcının söylediği birim (ör. 'koli', 'makara'); ürünün ana biriminde verme, boş bırak.");

const note = z.string().trim().max(500, 'Not en fazla 500 karakter olabilir.');

const proposalLine = z.strictObject({
  product_id: productId,
  quantity: proposalQuantity,
  unit: proposalUnit.optional(),
});

const lines = <T extends z.ZodType>(line: T) =>
  z
    .array(line)
    .min(1, 'En az bir kalem gerekli.')
    .max(PROPOSAL_MAX_LINES, `Bir öneride en fazla ${PROPOSAL_MAX_LINES} kalem olabilir.`)
    .describe('Kalemler; her ürün bir kez.');

export const proposeStockInToolInputSchema = z.strictObject({
  operation_id: operationId.optional(),
  warehouse_id: warehouseId.describe('Malın girdiği depo (list_warehouses sonucundaki warehouse_id).'),
  party_id: z
    .uuid({ error: 'party_id geçerli bir cari kimliği değil; tedarikçiyi önce search_parties ile bulun.' })
    .optional()
    .describe('İsteğe bağlı tedarikçi (search_parties sonucundaki party_id).'),
  note: note.optional().describe('İsteğe bağlı kısa not (ör. irsaliye numarası).'),
  lines: lines(
    proposalLine.extend({
      unit_cost: unitCostSchema
        .optional()
        .describe("İsteğe bağlı: girilen birim başına alış fiyatı, TL, metin; ondalık ayırıcı nokta (ör. '120.5')."),
    }),
  ),
});
export type ProposeStockInToolInput = z.infer<typeof proposeStockInToolInputSchema>;

export const proposeStockOutToolInputSchema = z.strictObject({
  operation_id: operationId.optional(),
  warehouse_id: warehouseId.describe('Malın çıktığı depo (list_warehouses sonucundaki warehouse_id).'),
  party_id: z
    .uuid({ error: 'party_id geçerli bir cari kimliği değil; müşteriyi önce search_parties ile bulun.' })
    .optional()
    .describe('İsteğe bağlı müşteri ya da şantiye (search_parties sonucundaki party_id).'),
  note: note.optional().describe('İsteğe bağlı kısa not.'),
  lines: lines(proposalLine),
});
export type ProposeStockOutToolInput = z.infer<typeof proposeStockOutToolInputSchema>;

export const proposeTransferToolInputSchema = z.strictObject({
  operation_id: operationId.optional(),
  source_warehouse_id: warehouseId.describe('Malın çıktığı depo (list_warehouses sonucundaki warehouse_id).'),
  target_warehouse_id: warehouseId.describe('Malın gittiği depo (list_warehouses sonucundaki warehouse_id).'),
  note: note.optional().describe('İsteğe bağlı kısa not.'),
  lines: lines(proposalLine),
});
export type ProposeTransferToolInput = z.infer<typeof proposeTransferToolInputSchema>;

export const proposeCountToolInputSchema = z.strictObject({
  operation_id: operationId.optional(),
  warehouse_id: warehouseId.describe('Sayımın yapıldığı depo (list_warehouses sonucundaki warehouse_id).'),
  note: note.optional().describe('İsteğe bağlı kısa not.'),
  lines: lines(
    z.strictObject({
      product_id: productId,
      counted_quantity: quantitySchema.describe(
        "Rafta sayılan miktar, kullanıcının söylediği birimde, metin olarak; 0 olabilir (ör. '112').",
      ),
      unit: proposalUnit.optional(),
    }),
  ),
});
export type ProposeCountToolInput = z.infer<typeof proposeCountToolInputSchema>;

export const proposeWasteToolInputSchema = z.strictObject({
  operation_id: operationId.optional(),
  warehouse_id: warehouseId.describe('Firenin düşüleceği depo (list_warehouses sonucundaki warehouse_id).'),
  note: note.optional().describe("Firenin nedeni, kullanıcının söylediği gibi (ör. 'kırık geldi')."),
  lines: lines(proposalLine),
});
export type ProposeWasteToolInput = z.infer<typeof proposeWasteToolInputSchema>;
