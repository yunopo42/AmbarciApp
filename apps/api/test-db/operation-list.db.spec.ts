// İşlem listesi gerçek veritabanında: onay bekleyenler en yeni önce, kalem sayısı ve depolar; durum süzgeci; çalışan
// yalnızca bütün depolarında yetkili olduğu işlemleri görür; başka şirketin işlemi görünmez. Oluşturulan her şey
// sonunda silinir.
import { memberSchema, operationListSchema } from '@ambarci/shared';
import type { OperationList } from '@ambarci/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

describe('İşlem listesi (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let employee = '';
  let noAccess = '';
  let productA = '';
  let productB = '';
  const ids = { stockIn: '', transfer: '', opening: '', applied: '' };

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'İşlem listesi' });
    other = await createStockFixture({ label: 'İşlem listesi B' });
    employee = await fx.addMember('EMPLOYEE');
    noAccess = await fx.addMember('EMPLOYEE');
    productA = await fx.addProduct('LST-A');
    productB = await fx.addProduct('LST-B');
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  async function list(path = '/v1/operations', userId?: string): Promise<OperationList> {
    return operationListSchema.parse((await fx.call('get', path, userId).expect(200)).body);
  }

  it('onay bekleyenler en yeni önce; kalem sayısı ve depolar; uygulanan ve iptal edilen listede yok', async () => {
    ids.stockIn = (
      await fx.open('STOCK_IN', [
        { productId: productA, warehouseId: fx.main, quantity: '5' },
        { productId: productB, warehouseId: fx.main, quantity: '3' },
      ])
    ).id;
    ids.transfer = (
      await fx.open('TRANSFER', [{ productId: productA, warehouseId: fx.main, targetWarehouseId: fx.branch, quantity: '1' }])
    ).id;
    ids.opening = (await fx.open('OPENING', [{ productId: productB, warehouseId: fx.branch, quantity: '2' }])).id;
    ids.applied = (await fx.apply('STOCK_IN', [{ productId: productA, warehouseId: fx.branch, quantity: '1' }])).operation.id;
    const cancelled = await fx.open('WASTE', [{ productId: productA, warehouseId: fx.main, quantity: '1' }]);
    await fx.call('post', `/v1/operations/${cancelled.id}/cancel`).expect(200);

    const pending = await list();
    expect(pending.items.map((item) => [item.id, item.type, item.status, item.source, item.lineCount])).toEqual([
      [ids.opening, 'OPENING', 'PENDING_CONFIRMATION', 'SCREEN', 1],
      [ids.transfer, 'TRANSFER', 'PENDING_CONFIRMATION', 'SCREEN', 1],
      [ids.stockIn, 'STOCK_IN', 'PENDING_CONFIRMATION', 'SCREEN', 2],
    ]);
    expect(pending.total).toBe(3);
    // Transfer iki depoya dokunur: çıkış ve hedef.
    const transfer = pending.items.find((item) => item.id === ids.transfer);
    expect(transfer?.warehouses.map((warehouse) => warehouse.name).sort()).toEqual(['Merkez', 'Ostim']);

    const page = await list('/v1/operations?pageSize=1&page=2');
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(page.items.map((item) => item.id)).toEqual([ids.transfer]);

    const applied = await list('/v1/operations?status=APPLIED');
    expect(applied.items.map((item) => item.id)).toEqual([ids.applied]);
  });

  it('çalışan yalnızca bütün depolarında yetkili olduğu işlemleri görür; açılış işlemlerini görmez', async () => {
    const members = memberSchema.array().parse((await fx.call('get', '/v1/members').expect(200)).body);
    const membership = members.find((member) => member.userId === employee);
    await fx.call('put', `/v1/members/${membership?.id}/warehouses/${fx.main}`).expect(204);

    // Transfer Ostim'e de dokunur, açılış yalnızca yöneticinin: ikisi de görünmez.
    const seen = await list('/v1/operations', employee);
    expect(seen.items.map((item) => item.id)).toEqual([ids.stockIn]);
    expect(seen.total).toBe(1);

    const none = await list('/v1/operations', noAccess);
    expect(none).toMatchObject({ items: [], total: 0 });
  });

  it('başka şirketin işlemi listede görünmez', async () => {
    const foreignProduct = await other.addProduct('LST-B-ONLY');
    const foreign = await other.open('STOCK_IN', [{ productId: foreignProduct, warehouseId: other.main, quantity: '1' }]);
    const pending = await list();
    expect(pending.items.map((item) => item.id)).not.toContain(foreign.id);
    expect(pending.total).toBe(3);
  });
});
