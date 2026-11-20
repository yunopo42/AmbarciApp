import { operationItems, operations } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import { CHAT_PROPOSAL_TTL_MINUTES, REVERSAL_WINDOW_MINUTES } from '@ambarci/shared';
import type {
  ActionSource,
  CreatableOperationType,
  Operation,
  OperationItem,
  OperationStatus,
  OperationType,
} from '@ambarci/shared';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

/** İşlem satırı (kalemsiz); onay sırasında FOR UPDATE ile okunur. */
export interface OperationRecord {
  id: string;
  type: OperationType;
  /** Kayıtlı durum. Süresi dolmuş sohbet önerisi kalıcı olarak EXPIRED'a geçene kadar burada onay bekler görünür. */
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
  /** Son değişiklik (açılış ya da sohbette düzenleme); sohbet önerisinin süresi buradan sayılır. */
  updatedAt: Date;
  /** Sohbetten açılmış, onay bekleyen ve son değişikliğinden bu yana 30 dakika geçmiş mi (veritabanının saatiyle). */
  expired: boolean;
  /** Yalnızca ters kayıtta: geri aldığı işlem (#78). */
  reversedOperationId: string | null;
  /** Uygulanalı 15 dakika olmadı mı (veritabanının saatiyle): işlemi açan kullanıcı bu süre içinde geri alabilir. */
  withinReversalWindow: boolean;
}

/**
 * Süre aşımının tek tanımı (#75): sohbetten açılmış, onay bekleyen ve son değişikliğinden bu yana
 * CHAT_PROPOSAL_TTL_MINUTES geçmiş öneri. Saat veritabanınındır (uygulama sunucusunun saati kaymış olabilir).
 * Zamanlanmış bir iş olmadığı için durum okumada bu ifadeyle hesaplanır; onay, düzenleme ya da iptal geldiğinde
 * kilit altında kalıcı olarak EXPIRED yazılır.
 */
const TTL = sql.raw(`interval '${CHAT_PROPOSAL_TTL_MINUTES} minutes'`);
const EXPIRED = sql<boolean>`(${operations.source} = 'CHAT' and ${operations.status} = 'PENDING_CONFIRMATION' and ${operations.updatedAt} < now() - ${TTL})`;
/** Aynı ifade, işlem listesinin ham sorgusundaki "o" takma adıyla. */
const EXPIRED_IN_LIST = sql`(o.source = 'CHAT' and o.status = 'PENDING_CONFIRMATION' and o.updated_at < now() - ${TTL})`;
/** Ekranda görünen durum: süresi dolmuş öneri, kalıcı olarak yazılmadan önce de EXPIRED görünür. */
const EFFECTIVE_STATUS_IN_LIST = sql`(case when ${EXPIRED_IN_LIST} then 'EXPIRED' else o.status::text end)`;

/**
 * Ters kayıt süresinin tek tanımı (#78): uygulanma anından bu yana REVERSAL_WINDOW_MINUTES geçmedi. Saat
 * veritabanınındır; istekte ve onayda işlem satırı kilitliyken aynı ifadeyle okunur.
 */
const REVERSAL_WINDOW = sql.raw(`interval '${REVERSAL_WINDOW_MINUTES} minutes'`);
const WITHIN_REVERSAL_WINDOW = sql<boolean>`coalesce(${operations.appliedAt} > now() - ${REVERSAL_WINDOW}, false)`;

/** Ters kaydın kalemi: geri alınan işlemin kalem numarasıyla (ters kaydın 2. kalemi, işlemin 2. kalemini geri alır). */
export interface NewReversal {
  organizationId: string;
  source: ActionSource;
  createdBy: string;
  reversedOperationId: string;
  items: OperationItem[];
}

export interface NewOperation {
  organizationId: string;
  type: CreatableOperationType;
  source: ActionSource;
  partyId: string | null;
  note: string | null;
  createdBy: string | null;
  /** Yalnızca sohbetten açılan işlemde: önerinin cevapladığı kullanıcı mesajı. */
  sourceMessageId?: string | null;
  items: Omit<OperationItem, 'lineNo'>[];
}

/** Onay bekleyen önerinin yeni hâli (sohbette düzenleme): kalemler baştan yazılır, sürüm artar. */
export interface OperationRevision {
  partyId: string | null;
  note: string | null;
  items: Omit<OperationItem, 'lineNo'>[];
  /** Verilirse işlemin bağı bu mesaja taşınır: düzenlemeyi isteyen kullanıcı mesajı (#75). */
  sourceMessageId?: string;
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
  updatedAt: operations.updatedAt,
  expired: EXPIRED,
  reversedOperationId: operations.reversedOperationId,
  withinReversalWindow: WITHIN_REVERSAL_WINDOW,
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

/**
 * Sohbet önerisinin onaylanabileceği son an: son değişiklik + 30 dakika. Yalnızca sohbetten açılmış ve kayıtlı durumu
 * onay bekleyen işlemde (süresi dolmuşsa geçmiş bir an); diğerlerinde null.
 */
export function expiresAtOf(record: Pick<OperationRecord, 'source' | 'status' | 'updatedAt'>): Date | null {
  if (record.source !== 'CHAT' || record.status !== 'PENDING_CONFIRMATION') {
    return null;
  }
  return new Date(record.updatedAt.getTime() + CHAT_PROPOSAL_TTL_MINUTES * 60_000);
}

/** API cevabındaki biçim: tarihler ISO metni; onay anahtarı istemciye dönmez; süresi dolmuş öneri EXPIRED görünür. */
export function toOperation(record: OperationRecord, items: OperationItem[]): Operation {
  return {
    id: record.id,
    type: record.type,
    status: record.expired ? 'EXPIRED' : record.status,
    source: record.source,
    version: record.version,
    partyId: record.partyId,
    note: record.note,
    createdBy: record.createdBy,
    appliedBy: record.appliedBy,
    appliedAt: record.appliedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    expiresAt: expiresAtOf(record)?.toISOString() ?? null,
    reversedOperationId: record.reversedOperationId,
    items,
  };
}

/** Sohbet geçmişinde kart: bir mesajın açtığı işlem, sürümü, türü ve görünen durumu (süresi dolmuşsa EXPIRED). */
export interface MessageOperation {
  id: string;
  sourceMessageId: string;
  version: number;
  type: OperationType;
  status: OperationStatus;
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
    // Süresi dolmuş sohbet önerisi, kalıcı olarak yazılmadan önce de "onay bekleyen" listesinde görünmez, EXPIRED
    // listesinde görünür (#75). Kayıtlı durumla önce daraltılır: (şirket, durum, tarih) indeksi kullanılsın.
    const stored: OperationStatus[] = filter.status === 'EXPIRED' ? ['EXPIRED', 'PENDING_CONFIRMATION'] : [filter.status];
    const storedIn = sql.join(
      stored.map((status) => sql`${status}`),
      sql`, `,
    );
    // Kalemler işlemle birleştirilir: kalem sayısı ve çıkış/hedef depoların tekrarsız listesi.
    const summaries = sql`
      with s as (
        select o.id, o.type, ${EFFECTIVE_STATUS_IN_LIST} as status, o.source, o.created_at, count(*)::int as line_count,
               array(
                 select distinct w
                 from unnest(array_agg(i.warehouse_id) || array_agg(i.target_warehouse_id)) as w
                 where w is not null
               ) as warehouse_ids
        from ${operations} o
        join ${operationItems} i on i.organization_id = o.organization_id and i.operation_id = o.id
        where o.organization_id = ${organizationId} and o.status in (${storedIn})
          and ${EFFECTIVE_STATUS_IN_LIST} = ${filter.status} ${excluded}
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
        sourceMessageId: input.sourceMessageId ?? null,
      })
      .returning(OPERATION_COLUMNS);
    if (!record) {
      throw new Error('İşlem eklenemedi.');
    }
    const items = await this.insertItems(executor, input.organizationId, record.id, input.items);
    return toOperation(record, items);
  }

  /**
   * Onay bekleyen işlemin kalemlerini yenileriyle değiştirir ve sürümü bir artırır. Çağıran işlemi FOR UPDATE ile
   * kilitlemiş ve durumunu denetlemiş olmalı; durum koşulu ikinci bir güvencedir. Onay bekleyen işlemin hareketi
   * olmadığı için kalemleri silmek hiçbir hareketi etkilemez. Eski sürümü gören onay isteği sürüm farkıyla reddedilir.
   */
  async revise(
    executor: DbExecutor,
    organizationId: string,
    operationId: string,
    revision: OperationRevision,
  ): Promise<Operation | null> {
    const [record] = await executor
      .update(operations)
      // Son değişiklik veritabanının saatiyle: önerinin süresi (30 dakika) bundan sayılır ve aynı saatle denetlenir.
      .set({
        partyId: revision.partyId,
        note: revision.note,
        version: sql`${operations.version} + 1`,
        updatedAt: sql`now()`,
        ...(revision.sourceMessageId ? { sourceMessageId: revision.sourceMessageId } : {}),
      })
      .where(
        and(
          eq(operations.organizationId, organizationId),
          eq(operations.id, operationId),
          eq(operations.status, 'PENDING_CONFIRMATION'),
        ),
      )
      .returning(OPERATION_COLUMNS);
    if (!record) {
      return null;
    }
    await executor
      .delete(operationItems)
      .where(and(eq(operationItems.organizationId, organizationId), eq(operationItems.operationId, operationId)));
    const items = await this.insertItems(executor, organizationId, operationId, revision.items);
    return toOperation(record, items);
  }

  private insertItems(
    executor: DbExecutor,
    organizationId: string,
    operationId: string,
    items: Omit<OperationItem, 'lineNo'>[],
  ): Promise<OperationItem[]> {
    return executor
      .insert(operationItems)
      .values(items.map((item, index) => ({ ...item, organizationId, operationId, lineNo: index + 1 })))
      .returning(ITEM_COLUMNS);
  }

  /**
   * Onay bekleyen ters kaydı (REVERSAL) ve kalemlerini ekler (#78). Kalem numaraları geri alınan işleminkilerdir;
   * stok değiştirmeyen kalem (ör. farkı çıkmayan sayım) atlandığı için numaralar ardışık olmayabilir. İşlemin etkin
   * bir ters kaydı varsa kısmi benzersiz indeks eklemeyi reddeder (23505).
   */
  async insertReversal(executor: DbExecutor, input: NewReversal): Promise<Operation> {
    const [record] = await executor
      .insert(operations)
      .values({
        organizationId: input.organizationId,
        type: 'REVERSAL',
        source: input.source,
        createdBy: input.createdBy,
        reversedOperationId: input.reversedOperationId,
      })
      .returning(OPERATION_COLUMNS);
    if (!record) {
      throw new Error('Ters kayıt eklenemedi.');
    }
    const items = await executor
      .insert(operationItems)
      .values(
        input.items.map(({ lineNo, ...item }) => ({ ...item, lineNo, organizationId: input.organizationId, operationId: record.id })),
      )
      .returning(ITEM_COLUMNS);
    return toOperation(record, items);
  }

  /**
   * İşlemin etkin ters kaydı (#78): onay bekleyen ya da uygulanmış; iptal edilmiş, süresi dolmuş ya da başarısız olan
   * sayılmaz. Kısmi benzersiz indeks yüzünden en fazla bir tane vardır. Süresi dolmuş sohbet önerisi kalıcı olarak
   * EXPIRED yazılana kadar burada görünür (expired alanıyla); çağıran onu önce EXPIRED yapar.
   */
  async findActiveReversal(
    executor: DbExecutor,
    organizationId: string,
    reversedOperationId: string,
  ): Promise<OperationRecord | null> {
    const [record] = await executor
      .select(OPERATION_COLUMNS)
      .from(operations)
      .where(
        and(
          eq(operations.organizationId, organizationId),
          eq(operations.reversedOperationId, reversedOperationId),
          sql`${operations.status} not in ('CANCELLED', 'EXPIRED', 'FAILED')`,
        ),
      )
      .limit(1);
    return record ?? null;
  }

  /**
   * Uygulanmış işlemi geri alındı (REVERSED) olarak işaretler; ters kaydın onay transaction'ında, işlem kilitliyken.
   * Durum koşulu ikinci bir güvencedir: yalnızca uygulanmış işlem geri alınır, uygulanma zamanı korunur.
   */
  async markReversed(executor: DbExecutor, organizationId: string, operationId: string): Promise<OperationRecord | null> {
    const [record] = await executor
      .update(operations)
      .set({ status: 'REVERSED' })
      .where(
        and(eq(operations.organizationId, organizationId), eq(operations.id, operationId), eq(operations.status, 'APPLIED')),
      )
      .returning(OPERATION_COLUMNS);
    return record ?? null;
  }

  /** İşlem satırı kilitlemeden (önizleme ve ters kaydın kilit sırasını belirlemek için). */
  async findRecord(executor: DbExecutor, organizationId: string, operationId: string): Promise<OperationRecord | null> {
    const [record] = await executor
      .select(OPERATION_COLUMNS)
      .from(operations)
      .where(and(eq(operations.organizationId, organizationId), eq(operations.id, operationId)))
      .limit(1);
    return record ?? null;
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

  /**
   * Süresi dolmuş sohbet önerisini kalıcı olarak EXPIRED yapar (onay, düzenleme ya da iptal geldiğinde, kilit altında).
   * Koşul ikinci bir güvencedir: yalnızca gerçekten süresi dolmuş ve onay bekleyen öneri güncellenir.
   */
  async markExpired(executor: DbExecutor, organizationId: string, operationId: string): Promise<OperationRecord | null> {
    const [record] = await executor
      .update(operations)
      .set({ status: 'EXPIRED' })
      .where(and(eq(operations.organizationId, organizationId), eq(operations.id, operationId), EXPIRED))
      .returning(OPERATION_COLUMNS);
    return record ?? null;
  }

  /**
   * Aynı mesajdan öneri açan istekleri sıraya sokar (#79): transaction bitene kadar mesajın kimliğinden üretilen
   * anahtarla PostgreSQL'in "advisory" kilidi tutulur. Mesajın kendi satırı kilitlenmez (o tablo asistan modülünün);
   * bu kilit yalnızca aynı anahtarı isteyen öteki transaction'ı bekletir. İki farklı mesajın anahtarı çakışırsa
   * yalnızca biraz bekleme olur, sonuç değişmez.
   */
  async lockChatProposals(executor: DbExecutor, sourceMessageId: string): Promise<void> {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sourceMessageId}::text, 0))`);
  }

  /** Mesajın açtığı, onay bekleyen ve süresi dolmamış, verilen türdeki sohbet önerileri, kalemleriyle (#79). */
  async listOpenChatProposals(
    executor: DbExecutor,
    organizationId: string,
    sourceMessageId: string,
    type: OperationType,
  ): Promise<Operation[]> {
    const records = await executor
      .select(OPERATION_COLUMNS)
      .from(operations)
      .where(
        and(
          eq(operations.organizationId, organizationId),
          eq(operations.sourceMessageId, sourceMessageId),
          eq(operations.type, type),
          eq(operations.source, 'CHAT'),
          eq(operations.status, 'PENDING_CONFIRMATION'),
          sql`not ${EXPIRED}`,
        ),
      )
      .orderBy(asc(operations.createdAt), asc(operations.id));
    const result: Operation[] = [];
    for (const record of records) {
      result.push(toOperation(record, await this.listItems(executor, organizationId, record.id)));
    }
    return result;
  }

  /** Mesajların açtığı işlemler (sohbet geçmişindeki kartlar, #75), açılış sırasıyla. */
  async listBySourceMessages(executor: DbExecutor, organizationId: string, messageIds: string[]): Promise<MessageOperation[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const rows = await executor
      .select({
        id: operations.id,
        sourceMessageId: operations.sourceMessageId,
        version: operations.version,
        type: operations.type,
        status: operations.status,
        expired: EXPIRED,
      })
      .from(operations)
      .where(and(eq(operations.organizationId, organizationId), inArray(operations.sourceMessageId, messageIds)))
      .orderBy(asc(operations.createdAt), asc(operations.id));
    return rows.flatMap((row) =>
      row.sourceMessageId
        ? [
            {
              id: row.id,
              sourceMessageId: row.sourceMessageId,
              version: row.version,
              type: row.type,
              status: row.expired ? ('EXPIRED' as const) : row.status,
            },
          ]
        : [],
    );
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
