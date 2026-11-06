// Asistanın okuma araçları gerçek veritabanında: yazım hatalarına dayanıklı ürün araması (pg_trgm), stok sorgusu,
// son hareketler ve depolar. Çalışanın depo yetkisi, başka şirketin kaydı ve pasif kayıtlar denetlenir. Model
// çağrılmaz; araçlar kayıt defterinden, API'nin gerçek servisleriyle çalıştırılır. Oluşturulan her şey sonunda silinir.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ToolRegistry } from '../src/modules/assistant/tools/registry.js';
import type { ToolContext } from '../src/modules/assistant/tools/registry.js';
import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

interface Candidate {
  product_id: string;
  sku: string;
  name: string;
  score: number;
  matched_alias: string | null;
}

describe('Asistanın okuma araçları (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let tools: ToolRegistry;
  let admin: ToolContext;
  let employee: ToolContext;
  const product = {
    nym25: randomUUID(),
    nym15: randomUUID(),
    fire: randomUUID(),
    groundedSocket: randomUUID(),
    tripleSocket: randomUUID(),
    retired: randomUUID(),
  };
  let otherProduct = '';
  const closedWarehouse = randomUUID();

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Asistan araçları' });
    other = await createStockFixture({ label: 'Asistan araçları B' });
    tools = fx.app.get(ToolRegistry, { strict: false });

    await fx.db.execute(sql`insert into products (id, organization_id, sku, name, base_unit, is_active) values
      (${product.nym25}, ${fx.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre', true),
      (${product.nym15}, ${fx.org}, 'KBL-NYM-15', 'NYM kablo 3x1,5 mm²', 'metre', true),
      (${product.fire}, ${fx.org}, 'KBL-YNG', 'Yangın kablosu 2x1,5', 'metre', true),
      (${product.groundedSocket}, ${fx.org}, 'PRZ-TOP-B', 'Topraklı priz, beyaz', 'adet', true),
      (${product.tripleSocket}, ${fx.org}, 'PRZ-UCL', 'Üçlü grup priz', 'adet', true),
      (${product.retired}, ${fx.org}, 'KBL-NYM-ESKI', 'NYM kablo 3x2,5 mm² eski', 'metre', false)`);
    await fx.db.execute(sql`insert into product_aliases (organization_id, product_id, alias) values
      (${fx.org}, ${product.nym25}, '3x2,5 kablo'),
      (${fx.org}, ${product.tripleSocket}, 'üçlü priz'),
      (${fx.org}, ${product.groundedSocket}, 'priz')`);
    await fx.db.execute(sql`insert into warehouses (id, organization_id, name, is_active) values
      (${closedWarehouse}, ${fx.org}, 'Kapalı depo', false)`);
    // Başka şirkette aynı adlı ürün: aramada görünmemeli, kimliğiyle sorulunca bulunamamalı.
    otherProduct = randomUUID();
    await other.db.execute(sql`insert into products (id, organization_id, sku, name, base_unit)
      values (${otherProduct}, ${other.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre')`);

    // Çalışan yalnızca Merkez'de yetkili.
    const employeeId = await fx.addMember('EMPLOYEE');
    const memberships = await fx.db.execute<{ id: string; userId: string }>(sql`
      select id, user_id as "userId" from organization_users where organization_id = ${fx.org}`);
    const membershipOf = (userId: string): string => memberships.find((row) => row.userId === userId)?.id ?? '';
    await fx.db.execute(sql`insert into user_warehouse_access (organization_id, organization_user_id, warehouse_id)
      values (${fx.org}, ${membershipOf(employeeId)}, ${fx.main})`);
    admin = { organization: { id: fx.org, role: 'ADMIN', membershipId: membershipOf(fx.admin) }, userId: fx.admin };
    employee = { organization: { id: fx.org, role: 'EMPLOYEE', membershipId: membershipOf(employeeId) }, userId: employeeId };

    // Stok: Merkez 1.412,5 metre ve Ostim 40 metre giriş, sonra Merkez'den 12,5 metre çıkış.
    await fx.apply('STOCK_IN', [
      { productId: product.nym25, warehouseId: fx.main, quantity: '1412.5', unitCost: '10' },
      { productId: product.nym25, warehouseId: fx.branch, quantity: '40', unitCost: '10' },
    ]);
    await fx.apply('STOCK_OUT', [{ productId: product.nym25, warehouseId: fx.main, quantity: '12.5' }]);
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  async function run<T>(name: string, input: unknown, context: ToolContext = admin): Promise<T> {
    const outcome = await tools.execute(name, input, context);
    expect(outcome.isError, outcome.content).toBe(false);
    return JSON.parse(outcome.content) as T;
  }

  const search = async (query: string): Promise<Candidate[]> =>
    (await run<{ candidates: Candidate[] }>('search_products', { query })).candidates;

  describe('search_products', () => {
    it('yazım hatalı ve eksik sorguda doğru ürün ilk sırada', async () => {
      expect((await search('kabllo nym 3x2,5'))[0]?.product_id).toBe(product.nym25);
      expect((await search('nym 3x1,5'))[0]?.product_id).toBe(product.nym15);
    });

    it('Türkçe harf farkı gözetilmez: "yangin" ve "YANGIN" yangın kablosunu bulur', async () => {
      expect((await search('yangin'))[0]?.product_id).toBe(product.fire);
      expect((await search('YANGIN KABLOSU'))[0]?.product_id).toBe(product.fire);
    });

    it('alternatif adla bulunur ve eşleşen ad bildirilir; İngilizce klavyeyle yazılan ad da bulunur', async () => {
      const [exact] = await search('üçlü priz');
      expect(exact).toMatchObject({ product_id: product.tripleSocket, matched_alias: 'üçlü priz', score: 1 });
      expect((await search('uclu priz')).map((candidate) => candidate.product_id)).toContain(product.tripleSocket);
    });

    it('stok kodu tam eşleşirse skor 1 (büyük/küçük harf farkı gözetilmez)', async () => {
      expect((await search('prz-top-b'))[0]).toMatchObject({ product_id: product.groundedSocket, score: 1 });
    });

    it('pasif ürün ve başka şirketin ürünü aday olmaz; en fazla 5 aday', async () => {
      const candidates = await search('nym kablo');
      const ids = candidates.map((candidate) => candidate.product_id);
      expect(ids).not.toContain(product.retired);
      expect(ids).not.toContain(otherProduct);
      expect(candidates.length).toBeLessThanOrEqual(5);
      expect(candidates.every((candidate) => candidate.score > 0 && candidate.score <= 1)).toBe(true);
    });
  });

  describe('get_stock', () => {
    it('yönetici bütün depoları ve SQL\'de hesaplanan toplamı Türkçe yazımla görür', async () => {
      const stock = await run<{ total: string; warehouses: { name: string; quantity: string }[] }>('get_stock', {
        product_id: product.nym25,
      });
      expect(stock.total).toBe('1.440');
      expect(stock.warehouses.map((row) => [row.name, row.quantity])).toEqual([
        ['Merkez', '1.400'],
        ['Ostim', '40'],
      ]);
    });

    it('çalışan yalnızca yetkili olduğu depoyu ve onun toplamını görür; yetkisiz depoyu soramaz', async () => {
      const stock = await run<{ total: string; warehouses: { name: string }[] }>('get_stock', { product_id: product.nym25 }, employee);
      expect(stock.total).toBe('1.400');
      expect(stock.warehouses.map((row) => row.name)).toEqual(['Merkez']);
      expect(await tools.execute('get_stock', { product_id: product.nym25, warehouse_id: fx.branch }, employee)).toEqual({
        isError: true,
        content: 'Kullanıcının bu depoyu görme yetkisi yok.',
      });
    });

    it('başka şirketin ürünü ve deposu bulunamadı görünür', async () => {
      expect(await tools.execute('get_stock', { product_id: otherProduct }, admin)).toEqual({ isError: true, content: 'Ürün bulunamadı.' });
      expect(await tools.execute('get_stock', { product_id: product.nym25, warehouse_id: other.main }, admin)).toEqual({
        isError: true,
        content: 'Depo bulunamadı ya da pasif.',
      });
    });
  });

  describe('list_recent_movements', () => {
    it('en yeni hareket önce; tür Türkçe, miktar işaretli; çalışan yalnızca yetkili deposunun hareketlerini görür', async () => {
      const forAdmin = await run<{ total: number; movements: { warehouse: string; type: string; quantity_change: string; quantity_after: string }[] }>(
        'list_recent_movements',
        { product_id: product.nym25 },
      );
      expect(forAdmin.total).toBe(3);
      expect(forAdmin.movements[0]).toMatchObject({ warehouse: 'Merkez', type: 'Çıkış', quantity_change: '−12,5', quantity_after: '1.400' });
      expect(forAdmin.movements.map((movement) => movement.type)).toEqual(['Çıkış', 'Giriş', 'Giriş']);

      const forEmployee = await run<{ total: number; movements: { warehouse: string }[] }>(
        'list_recent_movements',
        { product_id: product.nym25, limit: 1 },
        employee,
      );
      expect(forEmployee.total).toBe(2);
      expect(forEmployee.movements).toHaveLength(1);
      expect(forEmployee.movements.every((movement) => movement.warehouse === 'Merkez')).toBe(true);
    });
  });

  describe('list_warehouses', () => {
    it('pasif depo listelenmez; çalışan yalnızca yetkili olduğu depoyu görür', async () => {
      const forAdmin = await run<{ warehouses: { name: string }[] }>('list_warehouses', {});
      expect(forAdmin.warehouses.map((warehouse) => warehouse.name)).toEqual(['Merkez', 'Ostim']);
      const forEmployee = await run<{ warehouses: { warehouse_id: string; name: string; type: string }[] }>('list_warehouses', {}, employee);
      expect(forEmployee.warehouses).toEqual([{ warehouse_id: fx.main, name: 'Merkez', type: 'Depo' }]);
    });
  });
});
