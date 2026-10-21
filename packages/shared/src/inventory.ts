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
