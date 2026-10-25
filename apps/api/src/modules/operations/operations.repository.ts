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
import type { SQL } from 'drizzle-orm';

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

/** İşlem listesindeki satır: kalem sayısı ve dokunduğu depolar (transferde hedef dahil). */
// interface değil type: Drizzle'ın execute<T>() satır tipi indeks imzası ister.
export type OperationSummaryRow = {
  id: string;
  type: OperationType;
  status: OperationStatus;
  source: ActionSource;
  /** ISO 8601 (to_json); ham sorguda sürücü zaman damgasını metin döndürür. */
  createdAt: string;
  lineCount: number;
  warehouseIds: string[];
};

/** İşlem sorguları; her sorgu şirket kimliğiyle sınırlanır. */
@Injectable()
export class OperationsRepository {
  /**
   * İşlem özetleri, en yeni önce. `warehouseIds` verilirse yalnızca bütün depoları o listede olan işlemler (çalışan,
   * özetini açıp onaylayabileceği işlemleri görür); `excludeTypes` listelenmeyecek türler.
   */
  async listSummaries(
    executor: DbExecutor,
    organizationId: string,
    filter: { status: OperationStatus; warehouseIds: string[] | null; excludeTypes: OperationType[]; page: number; pageSize: number },
  ): Promise<{ items: OperationSummaryRow[]; total: number }> {
    if (filter.warehouseIds?.length === 0) {
      return { items: [], total: 0 };
    }
    const excluded: SQL =
      filter.excludeTypes.length > 0
        ? sql`and o.type not in (${sql.join(
            filter.excludeTypes.map((type) => sql`${type}`),
            sql`, `,
          )})`
        : sql``;
    const visible: SQL = filter.warehouseIds
      ? sql`where s.warehouse_ids <@ array[${sql.join(
          filter.warehouseIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}]`
      : sql``;
    // Kalemler işlemle birleştirilir: kalem sayısı ve çıkış/hedef depoların tekrarsız listesi.
    const summaries = sql`
      with s as (
        select o.id, o.type, o.status, o.source, o.created_at, count(*)::int as line_count,
               array(
                 select distinct w
                 from unnest(array_agg(i.warehouse_id) || array_agg(i.target_warehouse_id)) as w
                 where w is not null
               ) as warehouse_ids
        from ${operations} o
        join ${operationItems} i on i.organization_id = o.organization_id and i.operation_id = o.id
        where o.organization_id = ${organizationId} and o.status = ${filter.status} ${excluded}
        group by o.id
      )`;
    const [totalRow] = await executor.execute<{ total: number }>(sql`${summaries} select count(*)::int as total from s ${visible}`);
    const items = await executor.execute<OperationSummaryRow>(sql`${summaries}
      select id, type, status, source, to_json(created_at) #>> '{}' as "createdAt", line_count as "lineCount",
             warehouse_ids as "warehouseIds"
      from s ${visible}
      order by created_at desc, id
      limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}`);
    return { items, total: totalRow?.total ?? 0 };
  }

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
