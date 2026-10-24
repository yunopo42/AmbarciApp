import { z } from 'zod';

export const warehouseTypeSchema = z.enum(['WAREHOUSE', 'BRANCH', 'VEHICLE']);
export type WarehouseType = z.infer<typeof warehouseTypeSchema>;

export const warehouseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: warehouseTypeSchema,
  isActive: z.boolean(),
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const warehouseListSchema = z.array(warehouseSchema);

/** POST /v1/warehouses ve PUT /v1/warehouses/{id} (yalnızca yönetici). Depo silinmez, pasife alınır. */
export const warehouseInputSchema = z.object({
  /** Şirket içinde benzersiz; asistan depoyu adıyla bulur ("ana depoya 10 koli"). */
  name: z.string().trim().min(1).max(100),
  type: warehouseTypeSchema.default('WAREHOUSE'),
  isActive: z.boolean().default(true),
});
export type WarehouseInput = z.infer<typeof warehouseInputSchema>;
