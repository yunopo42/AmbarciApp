import { z } from 'zod';

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
