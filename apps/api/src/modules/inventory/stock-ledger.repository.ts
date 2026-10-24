import { inventory, inventoryMovements, stockCounts, warehouses } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import type { Movement, MovementType, ProductMovement, WarehouseType } from '@ambarci/shared';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { StockEffectInput } from './stock-preview.js';

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

  /** Ürünün herhangi bir depoda hareketi var mı (ana birimi değiştirilebilir mi). */
  async productHasMovements(executor: DbExecutor, organizationId: string, productId: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(and(eq(inventoryMovements.organizationId, organizationId), eq(inventoryMovements.productId, productId)))
      .limit(1);
    return row !== undefined;
  }

  /** Bir işlemin hareketleri, kalem sırasıyla (aynı onay tekrar geldiğinde aynı cevabı vermek için). */
  async listByOperation(executor: DbExecutor, organizationId: string, operationId: string): Promise<Movement[]> {
    return executor.execute<Movement>(sql`
      select ${MOVEMENT_RETURNING}
      from ${inventoryMovements}
      where organization_id = ${organizationId} and operation_id = ${operationId}
      order by line_no, created_at`);
  }

  /**
   * Onay ekranının "önce → sonra" hesabı. Etkiler onaydaki sırayla dizilir; aynı depo ve ürüne düşen önceki
   * etkilerin toplamı pencere fonksiyonuyla (sum … over) eklenir: aynı üründen iki çıkış kalemi varsa ikincisinin
   * "önce"si birincinin "sonra"sıdır. Kilit alınmaz; stok onay anında, kilit altında yeniden okunur.
   */
  async previewEffects(executor: DbExecutor, organizationId: string, effects: StockEffectInput[]): Promise<PreviewedEffect[]> {
    if (effects.length === 0) {
      return [];
    }
    const values = sql.join(
      effects.map(
        (effect) =>
          sql`(${effect.seq}::int, ${effect.lineNo}::int, ${effect.side}::text, ${effect.warehouseId}::uuid,
               ${effect.productId}::uuid, ${effect.kind}::text, ${effect.direction}::int, ${effect.quantity}::numeric)`,
      ),
      sql`, `,
    );
    return executor.execute<PreviewedEffect>(sql`
      with e(seq, line_no, side, warehouse_id, product_id, kind, direction, quantity) as (values ${values}),
      d as (
        select e.*, coalesce(i.quantity, 0) as stock,
               case when e.kind = 'count' then 0 else e.direction * e.quantity end as change
        from e
        left join ${inventory} i
          on i.organization_id = ${organizationId} and i.warehouse_id = e.warehouse_id and i.product_id = e.product_id
      ),
      r as (
        select d.*,
               d.stock + coalesce(sum(d.change) over (
                 partition by d.warehouse_id, d.product_id order by d.seq
                 rows between unbounded preceding and 1 preceding
               ), 0) as before
        from d
      )
      select line_no as "lineNo", side,
             round(before, 3) as before,
             case when kind = 'count' then round(quantity, 3) else round(before + change, 3) end as after,
             (kind = 'count' or before + change >= 0) as sufficient
      from r
      order by seq`);
  }

  /**
   * Verilen ürünlerin bir depodaki stoğu. Depoda satırı olmayan ürün 0 döner. Kritik eşik karşılaştırması da
   * SQL'de, NUMERIC ile yapılır.
   */
  async stockLevels(
    executor: DbExecutor,
    organizationId: string,
    warehouseId: string,
    products: { productId: string; minStock: string | null }[],
  ): Promise<StockLevelRow[]> {
    if (products.length === 0) {
      return [];
    }
    const values = sql.join(
      products.map((product) => sql`(${product.productId}::uuid, ${product.minStock}::numeric)`),
      sql`, `,
    );
    return executor.execute<StockLevelRow>(sql`
      select v.product_id as "productId",
             round(coalesce(i.quantity, 0), 3) as quantity,
             round(coalesce(i.average_cost, 0), 4) as "averageCost",
             (v.min_stock is not null and coalesce(i.quantity, 0) < v.min_stock) as "belowMinimum"
      from (values ${values}) as v(product_id, min_stock)
      left join ${inventory} i
        on i.organization_id = ${organizationId} and i.warehouse_id = ${warehouseId} and i.product_id = v.product_id`);
  }

  /**
   * Ürünün depolara göre stoğu. Satırı olmayan depo 0 döner; pasif depo yalnızca stoğu varsa listelenir.
   * `warehouseIds` verilirse yalnızca o depolar (çalışanın yetkili depoları). Toplam ve kritik eşik karşılaştırması
   * SQL'de, NUMERIC ile.
   */
  async productStockByWarehouse(
    executor: DbExecutor,
    organizationId: string,
    product: { productId: string; minStock: string | null },
    warehouseIds: string[] | null,
  ): Promise<ProductWarehouseStockRow[]> {
    if (warehouseIds?.length === 0) {
      return [];
    }
    const visible = warehouseIds
      ? sql`and w.id in (${sql.join(
          warehouseIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    return executor.execute<ProductWarehouseStockRow>(sql`
      select w.id, w.name, w.type, w.is_active as "isActive",
             round(coalesce(i.quantity, 0), 3) as quantity,
             round(coalesce(i.average_cost, 0), 4) as "averageCost",
             (${product.minStock}::numeric is not null and coalesce(i.quantity, 0) < ${product.minStock}::numeric) as "belowMinimum",
             round(sum(coalesce(i.quantity, 0)) over (), 3) as total
      from ${warehouses} w
      left join ${inventory} i
        on i.organization_id = w.organization_id and i.warehouse_id = w.id and i.product_id = ${product.productId}
      where w.organization_id = ${organizationId}
        and (w.is_active or coalesce(i.quantity, 0) > 0)
        ${visible}
      order by w.name`);
  }

  /**
   * Ürünün hareketleri, en yeni önce. `warehouseIds` verilirse yalnızca o depolardaki hareketler (çalışan yalnızca
   * yetkili olduğu depoları görür); `warehouseId` ekranın depo süzgecidir.
   */
  async listProductMovements(
    executor: DbExecutor,
    organizationId: string,
    productId: string,
    filter: { warehouseIds: string[] | null; warehouseId?: string | undefined; page: number; pageSize: number },
  ): Promise<{ items: ProductMovement[]; total: number }> {
    if (filter.warehouseIds?.length === 0) {
      return { items: [], total: 0 };
    }
    const conditions: SQL[] = [
      eq(inventoryMovements.organizationId, organizationId),
      eq(inventoryMovements.productId, productId),
    ];
    if (filter.warehouseIds) {
      conditions.push(inArray(inventoryMovements.warehouseId, filter.warehouseIds));
    }
    if (filter.warehouseId) {
      conditions.push(eq(inventoryMovements.warehouseId, filter.warehouseId));
    }
    const where = and(...conditions);
    const [totalRow] = await executor.select({ total: count() }).from(inventoryMovements).where(where);
    const rows = await executor
      .select({
        id: inventoryMovements.id,
        operationId: inventoryMovements.operationId,
        lineNo: inventoryMovements.lineNo,
        createdAt: inventoryMovements.createdAt,
        warehouseId: inventoryMovements.warehouseId,
        warehouseName: warehouses.name,
        type: inventoryMovements.type,
        quantityChange: inventoryMovements.quantityChange,
        unitCost: inventoryMovements.unitCost,
        quantityAfter: inventoryMovements.quantityAfter,
        averageCostAfter: inventoryMovements.averageCostAfter,
      })
      .from(inventoryMovements)
      .innerJoin(
        warehouses,
        and(eq(warehouses.organizationId, inventoryMovements.organizationId), eq(warehouses.id, inventoryMovements.warehouseId)),
      )
      .where(where)
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.lineNo))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return {
      items: rows.map(({ createdAt, warehouseId, warehouseName, ...row }) => ({
        ...row,
        createdAt: createdAt.toISOString(),
        warehouse: { id: warehouseId, name: warehouseName },
      })),
      total: totalRow?.total ?? 0,
    };
  }
}

/** Önizlenen bir etkinin sonucu (miktarlar ana birimde, metin). */
export type PreviewedEffect = {
  lineNo: number;
  side: 'source' | 'target';
  before: string;
  after: string;
  sufficient: boolean;
};

export type ProductWarehouseStockRow = {
  id: string;
  name: string;
  type: WarehouseType;
  isActive: boolean;
  quantity: string;
  averageCost: string;
  belowMinimum: boolean;
  /** Bütün satırlarda aynı: listelenen depoların toplamı. */
  total: string;
};

export type StockLevelRow = {
  productId: string;
  quantity: string;
  averageCost: string;
  belowMinimum: boolean;
};
