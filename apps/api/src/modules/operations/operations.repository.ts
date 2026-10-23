import { operationItems, operations } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import type {
  ActionSource,
  CreatableOperationType,
  Operation,
  OperationItem,
  OperationStatus,
  OperationType,
} from '@ambarci/shared';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';

/** İşlem satırı (kalemsiz); onay sırasında FOR UPDATE ile okunur. */
export interface OperationRecord {
  id: string;
  type: OperationType;
  status: OperationStatus;
  source: ActionSource;
  version: number;
  partyId: string | null;
  note: string | null;
  applyIdempotencyKey: string | null;
  createdBy: string | null;
  appliedBy: string | null;
  appliedAt: Date | null;
  createdAt: Date;
}

export interface NewOperation {
  organizationId: string;
  type: CreatableOperationType;
  source: ActionSource;
  partyId: string | null;
  note: string | null;
  createdBy: string | null;
  items: Omit<OperationItem, 'lineNo'>[];
}

const OPERATION_COLUMNS = {
  id: operations.id,
  type: operations.type,
  status: operations.status,
  source: operations.source,
  version: operations.version,
  partyId: operations.partyId,
  note: operations.note,
  applyIdempotencyKey: operations.applyIdempotencyKey,
  createdBy: operations.createdBy,
  appliedBy: operations.appliedBy,
  appliedAt: operations.appliedAt,
  createdAt: operations.createdAt,
};

const ITEM_COLUMNS = {
  lineNo: operationItems.lineNo,
  productId: operationItems.productId,
  warehouseId: operationItems.warehouseId,
  targetWarehouseId: operationItems.targetWarehouseId,
  quantity: operationItems.quantity,
  unit: operationItems.unit,
  unitCost: operationItems.unitCost,
};

/** API cevabındaki biçim: tarihler ISO metni; onay anahtarı istemciye dönmez. */
export function toOperation(record: OperationRecord, items: OperationItem[]): Operation {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    source: record.source,
    version: record.version,
    partyId: record.partyId,
    note: record.note,
    createdBy: record.createdBy,
    appliedBy: record.appliedBy,
    appliedAt: record.appliedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    items,
  };
}

/** İşlem sorguları; her sorgu şirket kimliğiyle sınırlanır. */
@Injectable()
export class OperationsRepository {
  /** İşlemi ve kalemlerini ekler. executor açık bir transaction olmalı: ikisi birlikte yazılır ya da hiç yazılmaz. */
  async insert(executor: DbExecutor, input: NewOperation): Promise<Operation> {
    const [record] = await executor
      .insert(operations)
      .values({
        organizationId: input.organizationId,
        type: input.type,
        source: input.source,
        partyId: input.partyId,
        note: input.note,
        createdBy: input.createdBy,
      })
      .returning(OPERATION_COLUMNS);
    if (!record) {
      throw new Error('İşlem eklenemedi.');
    }
    const items = await executor
      .insert(operationItems)
      .values(
        input.items.map((item, index) => ({
          ...item,
          organizationId: input.organizationId,
          operationId: record.id,
          lineNo: index + 1,
        })),
      )
      .returning(ITEM_COLUMNS);
    return toOperation(record, items);
  }

  async findById(executor: DbExecutor, organizationId: string, operationId: string): Promise<Operation | null> {
    const [record] = await executor
      .select(OPERATION_COLUMNS)
      .from(operations)
      .where(and(eq(operations.organizationId, organizationId), eq(operations.id, operationId)))
      .limit(1);
    if (!record) {
      return null;
    }
    return toOperation(record, await this.listItems(executor, organizationId, operationId));
  }

  /**
   * İşlem satırını FOR UPDATE ile kilitler. Aynı işlem için aynı anda gelen ikinci onay burada bekler; birinci
   * bitince işlemi APPLIED görür. Kilit transaction bitince kalkar.
   */
  async lockForUpdate(executor: DbExecutor, organizationId: string, operationId: string): Promise<OperationRecord | null> {
    const [record] = await executor
      .select(OPERATION_COLUMNS)
      .from(operations)
      .where(and(eq(operations.organizationId, organizationId), eq(operations.id, operationId)))
      .limit(1)
      .for('update');
    return record ?? null;
  }

  listItems(executor: DbExecutor, organizationId: string, operationId: string): Promise<OperationItem[]> {
    return executor
      .select(ITEM_COLUMNS)
      .from(operationItems)
      .where(and(eq(operationItems.organizationId, organizationId), eq(operationItems.operationId, operationId)))
      .orderBy(asc(operationItems.lineNo));
  }

  /**
   * İşlemi uygulandı olarak işaretler. Durum koşulu ikinci bir güvencedir: işlem kilitli ve durumu kontrol
   * edilmiş olsa da yalnızca onay bekleyen işlem güncellenir. Onay anahtarı başka bir işlemde kullanılmışsa
   * operations_org_idempotency_key kısıtı ihlal edilir.
   */
  async markApplied(
    executor: DbExecutor,
    organizationId: string,
    operationId: string,
    input: { appliedBy: string | null; idempotencyKey: string },
  ): Promise<OperationRecord | null> {
    const [record] = await executor
      .update(operations)
      .set({
        status: 'APPLIED',
        // Uygulama sunucusunun değil, veritabanının saati (hareketlerin zamanıyla aynı kaynak).
        appliedAt: sql`now()`,
        appliedBy: input.appliedBy,
        applyIdempotencyKey: input.idempotencyKey,
      })
      .where(
        and(
          eq(operations.organizationId, organizationId),
          eq(operations.id, operationId),
          eq(operations.status, 'PENDING_CONFIRMATION'),
        ),
      )
      .returning(OPERATION_COLUMNS);
    return record ?? null;
  }

  async markCancelled(executor: DbExecutor, organizationId: string, operationId: string): Promise<OperationRecord | null> {
    const [record] = await executor
      .update(operations)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(operations.organizationId, organizationId),
          eq(operations.id, operationId),
          eq(operations.status, 'PENDING_CONFIRMATION'),
        ),
      )
      .returning(OPERATION_COLUMNS);
    return record ?? null;
  }

  /** Bu anahtarla uygulanmış işlem (açılış betiğinin tekrar çalıştırılması için). */
  async findIdByIdempotencyKey(executor: DbExecutor, organizationId: string, key: string): Promise<string | null> {
    const [row] = await executor
      .select({ id: operations.id })
      .from(operations)
      .where(and(eq(operations.organizationId, organizationId), eq(operations.applyIdempotencyKey, key)))
      .limit(1);
    return row?.id ?? null;
  }
}
