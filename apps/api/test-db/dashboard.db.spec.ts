// Gösterge panelinin uçları gerçek veritabanında (#87): kritik stoktaki ürünler depo bazında (eşik SQL'de; yalnızca
// stok satırı olan aktif ürün ve aktif depo; en ağır eksik önce) ve şirketin son hareketleri (en yeni önce, ürün
// bilgisiyle); depo süzgeci ve sayfalama; çalışan yalnızca yetkili olduğu depoları görür; başka şirketin verisi
// görünmez. Testler sırayla çalışır ve aynı stoğu kullanır. Oluşturulan her şey sonunda silinir.
import { criticalStockListSchema, memberSchema, recentMovementListSchema } from '@ambarci/shared';
import type { CriticalStockList, RecentMovementList } from '@ambarci/shared';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

describe('Gösterge paneli: kritik stok ve son hareketler (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let employee = '';
  let van = '';
  const p = { low: '', lower: '', ok: '', noMin: '', inactive: '', mainOnly: '', emptied: '', foreign: '' };

  async function setMinStock(productId: string, minStock: string): Promise<void> {
    await fx.db.execute(sql`update products set min_stock = ${minStock}::numeric where id = ${productId}`);
  }

  async function critical(path = '/v1/stock/critical', userId?: string): Promise<CriticalStockList> {
    return criticalStockListSchema.parse((await fx.call('get', path, userId).expect(200)).body);
  }

  async function movements(path = '/v1/movements', userId?: string): Promise<RecentMovementList> {
    return recentMovementListSchema.parse((await fx.call('get', path, userId).expect(200)).body);
  }

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Gösterge paneli' });
    other = await createStockFixture({ label: 'Gösterge paneli B' });
    employee = await fx.addMember('EMPLOYEE');
    p.low = await fx.addProduct('GP-LOW');
    p.lower = await fx.addProduct('GP-LOWER');
    p.ok = await fx.addProduct('GP-OK');
    p.noMin = await fx.addProduct('GP-NOMIN');
    p.inactive = await fx.addProduct('GP-INACTIVE');
    p.mainOnly = await fx.addProduct('GP-MAINONLY');
    p.emptied = await fx.addProduct('GP-EMPTIED');
    await setMinStock(p.low, '10');
    await setMinStock(p.lower, '10');
    await setMinStock(p.ok, '5');
    await setMinStock(p.inactive, '3');
    await setMinStock(p.mainOnly, '8');
    await setMinStock(p.emptied, '5');

    // Üçüncü depo (araç): içinde eşik altı stok var ama depo sonra pasife alınır.
    van = randomUUID();
    await fx.db.execute(sql`insert into warehouses (id, organization_id, name, type) values (${van}, ${fx.org}, 'Araç 1', 'VEHICLE')`);

    // Merkez: low 4/10, lower 1/10, ok 20/5, noMin 1 (eşik yok), inactive 1/3 (ürün pasif olacak), mainOnly 9/8.
    await fx.apply('STOCK_IN', [
      { productId: p.low, warehouseId: fx.main, quantity: '4' },
      { productId: p.lower, warehouseId: fx.main, quantity: '1' },
      { productId: p.ok, warehouseId: fx.main, quantity: '20' },
      { productId: p.noMin, warehouseId: fx.main, quantity: '1' },
      { productId: p.inactive, warehouseId: fx.main, quantity: '1' },
      { productId: p.mainOnly, warehouseId: fx.main, quantity: '9' },
    ]);
    // Ostim: low 15/10 (yeterli); emptied 2 girip 2 çıkar, 0/5. mainOnly Ostim'de hiç tutulmaz (stok satırı yok).
    await fx.apply('STOCK_IN', [
      { productId: p.low, warehouseId: fx.branch, quantity: '15' },
      { productId: p.emptied, warehouseId: fx.branch, quantity: '2' },
    ]);
    await fx.apply('STOCK_OUT', [{ productId: p.emptied, warehouseId: fx.branch, quantity: '2' }]);
    // Araç: lower 1/10, sonra depo pasif.
    await fx.apply('STOCK_IN', [{ productId: p.lower, warehouseId: van, quantity: '1' }]);
    await fx.db.execute(sql`update warehouses set is_active = false where id = ${van}`);
    await fx.db.execute(sql`update products set is_active = false where id = ${p.inactive}`);

    // Başka şirket: kendi deposunda eşik altı ürün ve hareket.
    p.foreign = await other.addProduct('GP-FOREIGN');
    await other.db.execute(sql`update products set min_stock = 10 where id = ${p.foreign}`);
    await other.apply('STOCK_IN', [{ productId: p.foreign, warehouseId: other.main, quantity: '1' }]);

    // Çalışan yalnızca Merkez'de yetkili.
    const members = memberSchema.array().parse((await fx.call('get', '/v1/members').expect(200)).body);
    const membership = members.find((member) => member.userId === employee);
    await fx.call('put', `/v1/members/${membership?.id}/warehouses/${fx.main}`).expect(204);
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  it('kritik stok: depo adına, sonra en ağır eksiğe göre; eşiksiz, pasif ürün, pasif depo ve satırı olmayan depo sayılmaz', async () => {
    const list = await critical();
    expect(list.items.map((item) => [item.warehouse.name, item.product.sku, item.quantity, item.minStock])).toEqual([
      ['Merkez', 'GP-LOWER', '1.000', '10.000'],
      ['Merkez', 'GP-LOW', '4.000', '10.000'],
      // Stoğu sıfıra inen ürün kritik: satırı var, miktar eşiğin altında.
      ['Ostim', 'GP-EMPTIED', '0.000', '5.000'],
    ]);
    expect(list.total).toBe(3);
    expect(list.items[0]?.product).toEqual({ id: p.lower, sku: 'GP-LOWER', name: 'Test ürünü GP-LOWER', baseUnit: 'adet' });
    expect(list.items[0]?.warehouse).toEqual({ id: fx.main, name: 'Merkez' });
  });

  it('kritik stok: depo süzgeci ve sayfalama', async () => {
    const branch = await critical(`/v1/stock/critical?warehouseId=${fx.branch}`);
    expect(branch.items.map((item) => item.product.id)).toEqual([p.emptied]);
    const page = await critical('/v1/stock/critical?pageSize=2&page=2');
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page.items.map((item) => item.product.id)).toEqual([p.emptied]);
  });

  it('kritik stok: çalışan yalnızca yetkili olduğu depoları görür; başka şirketin stoğu görünmez', async () => {
    const seen = await critical('/v1/stock/critical', employee);
    expect(seen.items.map((item) => item.warehouse.name)).toEqual(['Merkez', 'Merkez']);
    expect(seen.total).toBe(2);
    expect(await critical(`/v1/stock/critical?warehouseId=${fx.branch}`, employee)).toMatchObject({ items: [], total: 0 });
    expect((await critical()).items.map((item) => item.product.id)).not.toContain(p.foreign);
  });

  it('son hareketler: en yeni önce, ürün bilgisiyle; toplam şirketin bütün hareketleri', async () => {
    const list = await movements();
    const [count] = await fx.db.execute<{ total: number }>(
      sql`select count(*)::int as total from inventory_movements where organization_id = ${fx.org}`,
    );
    expect(list.total).toBe(count?.total);
    // En yeni: araç deposuna giriş; ondan önce Ostim'den çıkış.
    expect(list.items[0]).toMatchObject({
      type: 'IN',
      quantityChange: '1.000',
      warehouse: { id: van, name: 'Araç 1' },
      product: { id: p.lower, sku: 'GP-LOWER', name: 'Test ürünü GP-LOWER', baseUnit: 'adet' },
    });
    expect(list.items[1]).toMatchObject({ type: 'OUT', quantityChange: '-2.000', product: { id: p.emptied } });
    const times = list.items.map((item) => new Date(item.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('son hareketler: depo süzgeci, sayfalama; çalışan yalnızca yetkili olduğu depoyu görür; başka şirket görünmez', async () => {
    const branch = await movements(`/v1/movements?warehouseId=${fx.branch}`);
    expect(branch.total).toBe(3);
    expect(branch.items.every((item) => item.warehouse.id === fx.branch)).toBe(true);

    const all = await movements();
    const second = await movements('/v1/movements?pageSize=1&page=2');
    expect(second).toMatchObject({ total: all.total, page: 2, pageSize: 1 });
    expect(second.items.map((item) => item.id)).toEqual([all.items[1]?.id]);

    const seen = await movements('/v1/movements', employee);
    expect(seen.total).toBe(6);
    expect(seen.items.every((item) => item.warehouse.id === fx.main)).toBe(true);
    expect(all.items.map((item) => item.product.id)).not.toContain(p.foreign);
  });
});
