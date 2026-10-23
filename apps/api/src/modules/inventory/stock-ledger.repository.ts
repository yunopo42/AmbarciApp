import { inventory, inventoryMovements, stockCounts, warehouses } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import type { Movement, MovementType } from '@ambarci/shared';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

/** Bir stok satırının anahtarı: depo + ürün (şirket her sorguda ayrıca verilir). */
// interface değil type: Drizzle'ın execute<T>() satır tipi indeks imzası ister.
export type StockKey = {
  warehouseId: string;
  productId: string;
};

export type LockedStockRow = StockKey & {
  quantity: string;
  averageCost: string;
  warehouseActive: boolean;
};

/** Hareketin kaynağı: işlem + kalem; ve hareketi yazılacak stok satırı. */
export interface MovementTarget extends StockKey {
  organizationId: string;
  operationId: string;
  lineNo: number;
  /** Onay anındaki çevrim katsayısı; hareket kaydında saklanır. */
  unitFactor: string;
}

export type CountResult = {
  systemQuantity: string;
  countedQuantity: string;
  /** |sayılan − sistem| */
  magnitude: string;
  /** Farkın işareti: 1 fazla, −1 noksan, 0 tuttu. */
  direction: number;
};

// Hareket kaydının API'ye dönen alanları; INSERT … RETURNING ve geçmiş sorgusu aynı listeyi kullanır.
const MOVEMENT_RETURNING = sql`
  line_no as "lineNo", warehouse_id as "warehouseId", product_id as "productId", type,
  quantity_change as "quantityChange", unit_cost as "unitCost",
  quantity_after as "quantityAfter", average_cost_after as "averageCostAfter"`;

/**
 * Stok defterinin SQL'i: stok satırlarını açma ve kilitleme, stoğu değiştirip hareketi yazma, sayım sonucu.
 * Bu metotlar yalnızca onay transaction'ının içinden (executor = transaction) çağrılır. Bütün hesaplar SQL'de
 * NUMERIC ile yapılır (ADR-003); miktar ve maliyet uygulamaya metin olarak döner.
 */
@Injectable()
export class StockLedgerRepository {
  /**
   * Eksik stok satırlarını miktar 0 ile açar; var olanlara dokunmaz. Anahtarlar sıralı gelir: aynı satırı
   * aynı anda açmaya çalışan iki transaction da aynı sırayla bekler, birbirini kilitlemez.
   */
  async ensureRows(executor: DbExecutor, organizationId: string, keys: StockKey[]): Promise<void> {
    await executor
      .insert(inventory)
      .values(keys.map((key) => ({ organizationId, ...key })))
      .onConflictDoNothing({ target: [inventory.organizationId, inventory.warehouseId, inventory.productId] });
  }

  /**
   * Stok satırlarını FOR UPDATE ile kilitler: transaction bitene kadar başka bir işlem bu satırları değiştiremez
   * ve kilitlemek isteyen bekler. Kilit sırası ürün, sonra depo kimliğine göre artandır; bütün transaction'lar
   * kilitleri aynı sırayla aldığı için ikisi birbirinin tuttuğu satırı bekleyip kilitlenmez (deadlock).
   */
  async lockRows(executor: DbExecutor, organizationId: string, keys: StockKey[]): Promise<LockedStockRow[]> {
    const pairs = sql.join(
      keys.map((key) => sql`(${key.warehouseId}::uuid, ${key.productId}::uuid)`),
      sql`, `,
    );
    return executor.execute<LockedStockRow>(sql`
      select i.warehouse_id as "warehouseId", i.product_id as "productId", i.quantity,
             i.average_cost as "averageCost", w.is_active as "warehouseActive"
      from ${inventory} i
      join ${warehouses} w on w.organization_id = i.organization_id and w.id = i.warehouse_id
      where i.organization_id = ${organizationId} and (i.warehouse_id, i.product_id) in (${pairs})
      order by i.product_id, i.warehouse_id
      for update of i`);
  }

  /**
   * Stoğu artırır ve hareketi yazar (tek ifade). Birim maliyet verilirse hareketli ağırlıklı ortalama yeniden
   * hesaplanır: (stok × ortalama + giren × maliyet) ÷ (stok + giren), 4 ondalığa yuvarlanır. Maliyet yoksa giriş
   * mevcut ortalamayla yapılır ve ortalama değişmez. SET içindeki ifadeler satırın eski değerlerini görür.
   */
  async increase(
    executor: DbExecutor,
    target: MovementTarget,
    input: { type: MovementType; quantity: string; unitCost: string | null },
  ): Promise<Movement> {
    const { quantity, unitCost } = input;
    const [movement] = await executor.execute<Movement>(sql`
      with changed as (
        update ${inventory}
        set average_cost = case
              when ${unitCost}::numeric is null then average_cost
              else round((quantity * average_cost + ${quantity}::numeric * ${unitCost}::numeric)
                         / (quantity + ${quantity}::numeric), 4)
            end,
            quantity = quantity + ${quantity}::numeric,
            updated_at = now()
        where organization_id = ${target.organizationId}
          and warehouse_id = ${target.warehouseId} and product_id = ${target.productId}
        returning quantity, average_cost
      )
      insert into ${inventoryMovements}
        (organization_id, operation_id, line_no, warehouse_id, product_id, type, quantity_change, unit_factor,
         unit_cost, quantity_after, average_cost_after)
      select ${target.organizationId}::uuid, ${target.operationId}::uuid, ${target.lineNo}::smallint, ${target.warehouseId}::uuid,
             ${target.productId}::uuid, ${input.type}::movement_type, ${quantity}::numeric, ${target.unitFactor}::numeric,
             coalesce(${unitCost}::numeric, changed.average_cost), changed.quantity, changed.average_cost
      from changed
      returning ${MOVEMENT_RETURNING}`);
    if (!movement) {
      // Satır ensureRows ile açıldı ve kilitli; buraya gelinirse programlama hatasıdır.
      throw new Error('Stok satırı bulunamadı.');
    }
    return movement;
  }

  /**
   * Stoğu azaltır ve hareketi yazar (tek ifade). Stok yetmiyorsa UPDATE hiçbir satırı değiştirmez, hareket de
   * yazılmaz ve null döner; çağıran işlemi geri alır. Ortalama maliyet değişmez; hareket o anki ortalamayla
   * kaydedilir. Bu kontrol atlansa bile CHECK (quantity >= 0) kısıtı eksi stoğu reddeder.
   */
  async decrease(
    executor: DbExecutor,
    target: MovementTarget,
    input: { type: MovementType; quantity: string },
  ): Promise<Movement | null> {
    const { quantity } = input;
    const [movement] = await executor.execute<Movement>(sql`
      with changed as (
        update ${inventory}
        set quantity = quantity - ${quantity}::numeric,
            updated_at = now()
        where organization_id = ${target.organizationId}
          and warehouse_id = ${target.warehouseId} and product_id = ${target.productId}
          and quantity >= ${quantity}::numeric
        returning quantity, average_cost
      )
      insert into ${inventoryMovements}
        (organization_id, operation_id, line_no, warehouse_id, product_id, type, quantity_change, unit_factor,
         unit_cost, quantity_after, average_cost_after)
      select ${target.organizationId}::uuid, ${target.operationId}::uuid, ${target.lineNo}::smallint, ${target.warehouseId}::uuid,
             ${target.productId}::uuid, ${input.type}::movement_type, -(${quantity}::numeric), ${target.unitFactor}::numeric,
             changed.average_cost, changed.quantity, changed.average_cost
      from changed
      returning ${MOVEMENT_RETURNING}`);
    return movement ?? null;
  }

  /**
   * Sayım sonucunu yazar. Sistemdeki miktar aynı ifadede kilitli stok satırından okunur (öneri anındaki değer
   * değil). Farkı veritabanı hesaplar (stock_counts.difference); yönü ve büyüklüğü de buradan döner.
   */
  async recordCount(executor: DbExecutor, target: MovementTarget, countedQuantity: string): Promise<CountResult> {
    const [row] = await executor.execute<CountResult>(sql`
      insert into ${stockCounts}
        (organization_id, operation_id, line_no, warehouse_id, product_id, system_quantity, counted_quantity)
      select ${target.organizationId}::uuid, ${target.operationId}::uuid, ${target.lineNo}::smallint, ${target.warehouseId}::uuid,
             ${target.productId}::uuid, i.quantity, ${countedQuantity}::numeric
      from ${inventory} i
      where i.organization_id = ${target.organizationId}
        and i.warehouse_id = ${target.warehouseId} and i.product_id = ${target.productId}
      returning system_quantity as "systemQuantity", counted_quantity as "countedQuantity",
                abs(difference) as magnitude, sign(difference)::int as direction`);
    if (!row) {
      throw new Error('Sayılan stok satırı bulunamadı.');
    }
    return row;
  }

  /** Stok satırının o anki miktarı (yetersiz stok hatasının ayrıntısı için). */
  async currentQuantity(executor: DbExecutor, organizationId: string, key: StockKey): Promise<string> {
    const [row] = await executor
      .select({ quantity: inventory.quantity })
      .from(inventory)
      .where(
        and(
          eq(inventory.organizationId, organizationId),
          eq(inventory.warehouseId, key.warehouseId),
          eq(inventory.productId, key.productId),
        ),
      )
      .limit(1);
    return row?.quantity ?? '0';
  }

  /** Bir işlemin hareketleri, kalem sırasıyla (aynı onay tekrar geldiğinde aynı cevabı vermek için). */
  async listByOperation(executor: DbExecutor, organizationId: string, operationId: string): Promise<Movement[]> {
    return executor.execute<Movement>(sql`
      select ${MOVEMENT_RETURNING}
      from ${inventoryMovements}
      where organization_id = ${organizationId} and operation_id = ${operationId}
      order by line_no, created_at`);
  }
}
