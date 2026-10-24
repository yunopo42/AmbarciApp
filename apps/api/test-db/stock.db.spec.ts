// Stoğu okuyan uçlar gerçek veritabanında: onay önizlemesi (önce → sonra), depo bazında stok listesi ve ürünün
// hareket geçmişi; çalışanın depo yetkisi. Testler sırayla çalışır ve aynı stoğu kullanır. Oluşturulan her şey
// sonunda silinir.
import {
  apiErrorSchema,
  memberSchema,
  operationPreviewSchema,
  organizationMembershipSchema,
  productMovementListSchema,
  productSchema,
  productStockSchema,
  warehouseStockSchema,
} from '@ambarci/shared';
import type { OperationPreview } from '@ambarci/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

describe('Stok okuma uçları ve onay önizlemesi (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let employee = '';
  let priz = '';
  let kablo = '';

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Stok okuma' });
    other = await createStockFixture({ label: 'Stok okuma B' });
    employee = await fx.addMember('EMPLOYEE');
    const created = await fx
      .call('post', '/v1/products')
      .send({ sku: 'PRZ', name: 'Priz', baseUnit: 'adet', minStock: '50', units: [{ unit: 'koli', factor: '12' }] })
      .expect(201);
    priz = productSchema.parse(created.body).id;
    kablo = await fx.addProduct('KBL');
    // Merkez: 10 koli × 12 = 120 adet, koli 120 TL → adet 10 TL.
    await fx.apply('STOCK_IN', [{ productId: priz, warehouseId: fx.main, quantity: '10', unit: 'koli', unitCost: '120' }]);
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  async function preview(operationId: string): Promise<OperationPreview> {
    return operationPreviewSchema.parse((await fx.call('get', `/v1/operations/${operationId}/preview`).expect(200)).body);
  }

  it('önizleme: aynı üründen iki çıkış kalemi sırayla hesaplanır; yetmeyen kalem işaretlenir; stok değişmez', async () => {
    const operation = await fx.open('STOCK_OUT', [
      { productId: priz, warehouseId: fx.main, quantity: '3', unit: 'koli' },
      { productId: priz, warehouseId: fx.main, quantity: '100' },
    ]);
    const result = await preview(operation.id);

    expect(result).toMatchObject({ type: 'STOCK_OUT', status: 'PENDING_CONFIRMATION', version: 1 });
    expect(result.lines[0]).toMatchObject({
      sku: 'PRZ',
      productName: 'Priz',
      baseUnit: 'adet',
      unit: 'koli',
      warehouse: { id: fx.main, name: 'Merkez' },
      targetWarehouse: null,
      targetStock: null,
    });
    // İkinci kalemin "önce"si birincinin "sonra"sı: onay kalemleri bu sırayla uygular.
    expect(result.lines.map((line) => [line.baseQuantity, line.stock])).toEqual([
      ['36.000', { before: '120.000', after: '84.000', sufficient: true }],
      ['100.000', { before: '84.000', after: '-16.000', sufficient: false }],
    ]);
    expect(await fx.stockOf(fx.main, priz)).toMatchObject({ quantity: '120.000' });

    // Onay da aynı sonuca varır: ikinci kalem yetmez, hiçbir şey yazılmaz.
    const rejected = await fx.confirm(operation).expect(409);
    expect(errorCode(rejected.body)).toBe('INSUFFICIENT_STOCK');
  });

  it('önizleme: transferde kaynak ve hedef depo, sayımda sayılan miktar; onaylanmış işlemde stok hesaplanmaz', async () => {
    const transfer = await fx.open('TRANSFER', [
      { productId: priz, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '20' },
    ]);
    const [line] = (await preview(transfer.id)).lines;
    expect(line).toMatchObject({
      targetWarehouse: { id: fx.branch, name: 'Ostim' },
      stock: { before: '120.000', after: '100.000', sufficient: true },
      targetStock: { before: '0.000', after: '20.000', sufficient: true },
    });

    const count = await fx.open('COUNT', [{ productId: priz, warehouseId: fx.main, quantity: '115' }]);
    expect((await preview(count.id)).lines[0]?.stock).toEqual({ before: '120.000', after: '115.000', sufficient: true });

    await fx.confirm(transfer).expect(200);
    const applied = await preview(transfer.id);
    expect(applied.status).toBe('APPLIED');
    expect(applied.lines[0]).toMatchObject({ stock: null, targetStock: null });
  });

  it('depo bazında stok: miktar, ortalama maliyet ve kritik eşik; hareketi olmayan ürün 0; arama', async () => {
    const stock = warehouseStockSchema.parse((await fx.call('get', `/v1/warehouses/${fx.main}/stock`).expect(200)).body);
    expect(stock.warehouse.name).toBe('Merkez');
    const byId = new Map(stock.items.map((item) => [item.productId, item]));
    expect(byId.get(priz)).toMatchObject({ quantity: '100.000', averageCost: '10.0000', minStock: '50.000', belowMinimum: false });
    expect(byId.get(kablo)).toMatchObject({ quantity: '0.000', minStock: null, belowMinimum: false });

    // 60 adet çıkınca 40 kalır: eşik (50) altında.
    await fx.apply('STOCK_OUT', [{ productId: priz, warehouseId: fx.main, quantity: '60' }]);
    const searched = warehouseStockSchema.parse(
      (await fx.call('get', `/v1/warehouses/${fx.main}/stock?search=prz`).expect(200)).body,
    );
    expect(searched.items).toEqual([expect.objectContaining({ productId: priz, quantity: '40.000', belowMinimum: true })]);
  });

  it('çalışan yalnızca yetkili olduğu deponun stoğunu ve önizlemesini görür; üyeliği yetkili depoları listeler', async () => {
    const denied = await fx.call('get', `/v1/warehouses/${fx.main}/stock`, employee).expect(403);
    expect(errorCode(denied.body)).toBe('WAREHOUSE_FORBIDDEN');
    const pending = await fx.open('STOCK_OUT', [{ productId: priz, warehouseId: fx.main, quantity: '1' }]);
    await fx.call('get', `/v1/operations/${pending.id}/preview`, employee).expect(403);

    const members = memberSchema.array().parse((await fx.call('get', '/v1/members').expect(200)).body);
    const membership = members.find((member) => member.userId === employee);
    await fx.call('put', `/v1/members/${membership?.id}/warehouses/${fx.main}`).expect(204);

    await fx.call('get', `/v1/warehouses/${fx.main}/stock`, employee).expect(200);
    await fx.call('get', `/v1/warehouses/${fx.branch}/stock`, employee).expect(403);
    const organizations = organizationMembershipSchema
      .array()
      .parse((await fx.call('get', '/v1/organizations', employee).expect(200)).body);
    expect(organizations.find((organization) => organization.id === fx.org)?.warehouseIds).toEqual([fx.main]);
  });

  it('hareket geçmişi: en yeni önce, depo süzgeci; çalışan yalnızca yetkili deposununkileri; başka şirketin ürünü 404', async () => {
    const all = productMovementListSchema.parse((await fx.call('get', `/v1/products/${priz}/movements`).expect(200)).body);
    expect(all.items.map((movement) => [movement.type, movement.warehouse.name, movement.quantityChange])).toEqual([
      ['OUT', 'Merkez', '-60.000'],
      ['TRANSFER_IN', 'Ostim', '20.000'],
      ['TRANSFER_OUT', 'Merkez', '-20.000'],
      ['IN', 'Merkez', '120.000'],
    ]);
    expect(all.total).toBe(4);

    const branch = productMovementListSchema.parse(
      (await fx.call('get', `/v1/products/${priz}/movements?warehouseId=${fx.branch}`).expect(200)).body,
    );
    expect(branch.items.map((movement) => movement.type)).toEqual(['TRANSFER_IN']);

    const page = productMovementListSchema.parse(
      (await fx.call('get', `/v1/products/${priz}/movements?pageSize=1&page=2`).expect(200)).body,
    );
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 1 });
    expect(page.items.map((movement) => movement.type)).toEqual(['TRANSFER_IN']);

    // Çalışanın yetkisi yalnızca Merkez'de (önceki test): Ostim'in hareketi görünmez.
    const seenByEmployee = productMovementListSchema.parse(
      (await fx.call('get', `/v1/products/${priz}/movements`, employee).expect(200)).body,
    );
    expect(seenByEmployee.items.map((movement) => movement.warehouse.name)).toEqual(['Merkez', 'Merkez', 'Merkez']);

    const foreign = await other.addProduct('B-ONLY');
    const notFound = await fx.call('get', `/v1/products/${foreign}/movements`).expect(404);
    expect(errorCode(notFound.body)).toBe('PRODUCT_NOT_FOUND');
  });

  it("ürünün depolara göre stoğu: toplam ve kritik eşik SQL'de; çalışan yalnızca yetkili deposunu görür", async () => {
    // Merkez 40 (önceki testlerde 120 − 20 transfer − 60 çıkış), Ostim 20; eşik 50.
    const seen = productStockSchema.parse((await fx.call('get', `/v1/products/${priz}/stock`).expect(200)).body);
    expect(seen).toMatchObject({ baseUnit: 'adet', minStock: '50.000', total: '60.000' });
    expect(seen.warehouses.map((row) => [row.warehouse.name, row.quantity, row.belowMinimum])).toEqual([
      ['Merkez', '40.000', true],
      ['Ostim', '20.000', true],
    ]);

    // Hiç hareketi olmayan ürün bütün aktif depolarda 0 görünür.
    const empty = productStockSchema.parse((await fx.call('get', `/v1/products/${kablo}/stock`).expect(200)).body);
    expect(empty).toMatchObject({ total: '0.000', minStock: null });
    expect(empty.warehouses.map((row) => row.quantity)).toEqual(['0.000', '0.000']);

    // Çalışanın yetkisi yalnızca Merkez'de: toplam da yalnızca Merkez'in.
    const byEmployee = productStockSchema.parse((await fx.call('get', `/v1/products/${priz}/stock`, employee).expect(200)).body);
    expect(byEmployee.total).toBe('40.000');
    expect(byEmployee.warehouses.map((row) => row.warehouse.name)).toEqual(['Merkez']);

    const foreign = await other.addProduct('B-STOK');
    await fx.call('get', `/v1/products/${foreign}/stock`).expect(404);
  });
});
