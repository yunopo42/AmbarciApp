import { products, warehouses } from '@ambarci/db';
import type { Database } from '@ambarci/db';
import type { DemoOpeningStock } from '@ambarci/db/demo';
import { createOperationSchema } from '@ambarci/shared';
import { eq } from 'drizzle-orm';

import type { OperationsService } from '../modules/operations/operations.service.js';

export interface OpeningStockResult {
  warehouse: string;
  status: 'applied' | 'skipped';
  lineCount: number;
}

/**
 * Açılış stoklarını yükler. Stok doğrudan yazılmaz: her depo için bir açılış işlemi (OPENING, kaynak SYSTEM)
 * açılır ve kullanıcı onayıyla aynı transaction'dan geçer; hareket, ortalama maliyet, denetim ve outbox
 * kayıtları da böylece oluşur. Her deponun açılışı sabit bir Idempotency-Key taşır; aynı anahtarla uygulanmış
 * işlem varsa depo atlanır, yani betik tekrar çalıştırılınca stok ikinci kez girmez.
 */
export async function seedOpeningStock(
  db: Database,
  operations: OperationsService,
  organizationId: string,
  stocks: DemoOpeningStock[],
): Promise<OpeningStockResult[]> {
  // Betik bir kurulum aracı: demo verisindeki SKU ve depo adlarını kimliğe çevirmek için doğrudan okur.
  const productRows = await db
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(eq(products.organizationId, organizationId));
  const warehouseRows = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.organizationId, organizationId));
  const productIdOf = lookup(new Map(productRows.map((row) => [row.sku, row.id])), 'Ürün');
  const warehouseIdOf = lookup(new Map(warehouseRows.map((row) => [row.name, row.id])), 'Depo');

  const results: OpeningStockResult[] = [];
  for (const stock of stocks) {
    const warehouseId = warehouseIdOf(stock.warehouse);
    const idempotencyKey = `seed-opening:${warehouseId}`;
    if (await operations.findIdByIdempotencyKey(organizationId, idempotencyKey)) {
      results.push({ warehouse: stock.warehouse, status: 'skipped', lineCount: stock.lines.length });
      continue;
    }
    // Ekrandan gelen istekle aynı şema: betik de geçersiz bir işlem açamaz.
    const input = createOperationSchema.parse({
      type: 'OPENING',
      note: 'Açılış stoğu (demo verisi)',
      items: stock.lines.map((line) => ({
        productId: productIdOf(line.sku),
        warehouseId,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
    });
    const operation = await operations.create(organizationId, { kind: 'system' }, input, 'SYSTEM');
    await operations.confirm(organizationId, { kind: 'system' }, operation.id, { version: operation.version }, idempotencyKey);
    results.push({ warehouse: stock.warehouse, status: 'applied', lineCount: stock.lines.length });
  }
  return results;
}

function lookup(map: Map<string, string>, label: string): (key: string) => string {
  return (key) => {
    const id = map.get(key);
    if (!id) {
      throw new Error(`${label} bulunamadı: ${key}. Önce katalog seed'i çalışmalı (pnpm db:seed).`);
    }
    return id;
  };
}
