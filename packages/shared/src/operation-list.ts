import { z } from 'zod';

import { pageQuery } from './catalog.js';
import { actionSourceSchema, operationStatusSchema, operationTypeSchema } from './operations.js';
import { warehouseRefSchema } from './stock.js';

// İşlem listesi: onay kuyruğu (#87) ve onay bekleyen işlemlere geri dönmek için (ekrandan açılıp bırakılan fiş,
// içe aktarmanın açılış işlemi, sohbet önerisi).

/**
 * GET /v1/operations: varsayılan yalnızca onay bekleyenler, en yeni önce. Tür, kaynak ve depo süzgeçleri isteğe
 * bağlıdır; depo süzgeci işlemin dokunduğu depolardan birine (transferde hedef dahil) uyar.
 */
export const operationListQuerySchema = z.object({
  status: operationStatusSchema.default('PENDING_CONFIRMATION'),
  type: operationTypeSchema.optional(),
  source: actionSourceSchema.optional(),
  warehouseId: z.uuid().optional(),
  ...pageQuery,
});
export type OperationListQuery = z.infer<typeof operationListQuerySchema>;

/** İşlemi açan kullanıcı. Kullanıcıların görünen adı olmadığı için e-postası gösterilir. */
export const operationCreatorSchema = z.object({
  userId: z.uuid(),
  /** Şirketten ayrılmış ya da hesabı silinmiş kullanıcıda null. */
  email: z.string().nullable(),
});
export type OperationCreator = z.infer<typeof operationCreatorSchema>;

export const operationSummarySchema = z.object({
  id: z.uuid(),
  type: operationTypeSchema,
  status: operationStatusSchema,
  source: actionSourceSchema,
  /** Onay isteği bu sürümü gönderir; işlem bu arada düzenlendiyse onay "sürüm değişti" ile reddedilir. */
  version: z.number().int(),
  /** İşlemi açan; sistemin açtığı işlemde (açılış betiği) null. */
  createdBy: operationCreatorSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Yalnızca sohbetten açılmış, onay bekleyen öneride: onaylanabileceği son an (Operation.expiresAt ile aynı). */
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
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
