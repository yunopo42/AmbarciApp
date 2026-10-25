import { z } from 'zod';

import { pageQuery } from './catalog.js';
import { actionSourceSchema, operationStatusSchema, operationTypeSchema } from './operations.js';
import { warehouseRefSchema } from './stock.js';

// İşlem listesi: onay bekleyen işlemlere geri dönmek için (ekrandan açılıp bırakılan fiş, içe aktarmanın açılış
// işlemi). 5–6. haftadaki onay kuyruğu bunun üzerine kurulur.

/** GET /v1/operations: varsayılan yalnızca onay bekleyenler, en yeni önce. */
export const operationListQuerySchema = z.object({
  status: operationStatusSchema.default('PENDING_CONFIRMATION'),
  ...pageQuery,
});
export type OperationListQuery = z.infer<typeof operationListQuerySchema>;

export const operationSummarySchema = z.object({
  id: z.uuid(),
  type: operationTypeSchema,
  status: operationStatusSchema,
  source: actionSourceSchema,
  createdAt: z.iso.datetime({ offset: true }),
  lineCount: z.number().int(),
  /** İşlemin dokunduğu depolar (transferde hedef dahil). */
  warehouses: z.array(warehouseRefSchema),
});
export type OperationSummary = z.infer<typeof operationSummarySchema>;

export const operationListSchema = z.object({
  items: z.array(operationSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type OperationList = z.infer<typeof operationListSchema>;
