// İşlem listesi ve onay kuyruğu (#87) gerçek veritabanında: onay bekleyenler en yeni önce, kalem sayısı ve depolar;
// sürüm, açan kişi ve sohbet önerisinin son onay anı; durum, tür, kaynak ve depo süzgeci; çalışan yalnızca bütün
// depolarında yetkili olduğu işlemleri görür; süresi dolan öneri bekleyenlerde görünmez; başka şirketin işlemi
// görünmez. Testler sırayla çalışır. Oluşturulan her şey sonunda silinir.
import { memberSchema, operationListSchema } from '@ambarci/shared';
import type { OperationList } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
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

  async function idsOf(path: string, userId?: string): Promise<string[]> {
    return (await list(path, userId)).items.map((item) => item.id);
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

  it('özet satırında onay için sürüm, açan kişi ve son onay anı; ekrandan açılan işlemin süresi yok', async () => {
    const pending = await list();
    const stockIn = pending.items.find((item) => item.id === ids.stockIn);
    expect(stockIn).toMatchObject({
      version: 1,
      createdBy: { userId: fx.admin, email: `stok-${fx.admin}@test.invalid` },
      expiresAt: null,
    });
  });

  it('tür, kaynak ve depo süzgeci; depo süzgeci işlemin dokunduğu depolardan birine uyar; süzgeçler birlikte', async () => {
    expect(await idsOf('/v1/operations?type=TRANSFER')).toEqual([ids.transfer]);
    // Transfer iki depoya dokunur: Ostim'de hedef, Merkez'de çıkış.
    expect(await idsOf(`/v1/operations?warehouseId=${fx.branch}`)).toEqual([ids.opening, ids.transfer]);
    expect(await idsOf(`/v1/operations?warehouseId=${fx.main}`)).toEqual([ids.transfer, ids.stockIn]);
    expect(await idsOf(`/v1/operations?type=STOCK_IN&warehouseId=${fx.main}`)).toEqual([ids.stockIn]);
    expect(await list(`/v1/operations?type=STOCK_IN&warehouseId=${fx.branch}`)).toMatchObject({ items: [], total: 0 });
    expect((await list('/v1/operations?source=SCREEN')).total).toBe(3);
    expect(await list('/v1/operations?source=IMPORT')).toMatchObject({ items: [], total: 0 });
    // Süzgeçle sayfalama: toplam süzgece uyanların sayısı.
    const page = await list(`/v1/operations?warehouseId=${fx.main}&pageSize=1&page=2`);
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.items.map((item) => item.id)).toEqual([ids.stockIn]);
    // Süzgeç durumun yerine geçmez: uygulanmış işlem onay bekleyenlerde görünmez.
    expect(await idsOf(`/v1/operations?warehouseId=${fx.branch}&type=STOCK_IN`)).toEqual([]);
    expect(await idsOf(`/v1/operations?status=APPLIED&warehouseId=${fx.branch}`)).toEqual([ids.applied]);
  });

  it('geçersiz süzgeç 400 döner', async () => {
    await fx.call('get', '/v1/operations?type=TELEPORT').expect(400);
    await fx.call('get', '/v1/operations?source=FAX').expect(400);
    await fx.call('get', '/v1/operations?warehouseId=merkez').expect(400);
  });

  it('çalışan süzgeçle de yalnızca bütün depolarında yetkili olduğu işlemleri görür', async () => {
    // Çalışanın yalnızca Merkez yetkisi var (ikinci test): Ostim'e dokunan transfer ve açılış süzgeçle de görünmez.
    expect(await list(`/v1/operations?warehouseId=${fx.branch}`, employee)).toMatchObject({ items: [], total: 0 });
    expect(await list('/v1/operations?type=TRANSFER', employee)).toMatchObject({ items: [], total: 0 });
    expect(await list('/v1/operations?type=OPENING', employee)).toMatchObject({ items: [], total: 0 });
    expect(await idsOf(`/v1/operations?warehouseId=${fx.main}`, employee)).toEqual([ids.stockIn]);
    // Yetkisi olmayan depoyu süzmek başka depoların işlemini göstermez.
    expect(await list(`/v1/operations?warehouseId=${fx.main}`, noAccess)).toMatchObject({ items: [], total: 0 });
  });

  it('sohbet önerisinde son onay anı son değişiklik + 30 dakika; süresi dolan öneri bekleyenlerde görünmez', async () => {
    const fresh = await fx.open('WASTE', [{ productId: productA, warehouseId: fx.main, quantity: '1' }]);
    const stale = await fx.open('WASTE', [{ productId: productB, warehouseId: fx.main, quantity: '1' }]);
    // Sohbetten açılmış gibi: kaynak CHAT, son değişiklik 10 ve 31 dakika önce (saat veritabanının).
    await fx.db.execute(sql`update operations set source = 'CHAT', updated_at = now() - interval '10 minutes' where id = ${fresh.id}`);
    await fx.db.execute(sql`update operations set source = 'CHAT', updated_at = now() - interval '31 minutes' where id = ${stale.id}`);

    const chats = await list('/v1/operations?source=CHAT');
    expect(chats.items.map((item) => item.id)).toEqual([fresh.id]);
    expect(chats.total).toBe(1);
    const [row] = await fx.db.execute<{ expiresAt: string }>(
      sql`select to_json(updated_at + interval '30 minutes') #>> '{}' as "expiresAt" from operations where id = ${fresh.id}`,
    );
    expect(chats.items[0]?.expiresAt).toBe(row?.expiresAt);
    expect(new Date(chats.items[0]?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    // Süresi dolan öneri kalıcı olarak yazılmadan da onay bekleyenlerde görünmez; "süresi dolmuş" süzgecinde görünür.
    expect(await idsOf('/v1/operations?type=WASTE')).toEqual([fresh.id]);
    expect(await idsOf('/v1/operations?status=EXPIRED&source=CHAT')).toEqual([stale.id]);
    expect(await fx.statusOf(stale.id)).toBe('PENDING_CONFIRMATION');
  });
});
