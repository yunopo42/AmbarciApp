// Katalog yönetimi gerçek veritabanında: ürün (birimleri ve adlarıyla), cari, aynı SKU/barkod/VKN, başka şirketin
// kaydı, pasife alma, işlemde kullanılmış birim ve hareketi olan ürünün ana birimi. Oluşturulan her şey sonunda silinir.
import { randomUUID } from 'node:crypto';

import { apiErrorSchema, partySchema, productListSchema, productSchema } from '@ambarci/shared';
import type { Product } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

describe('Katalog yönetimi (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let employee = '';

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Katalog' });
    other = await createStockFixture({ label: 'Katalog B' });
    employee = await fx.addMember('EMPLOYEE');
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  async function createProduct(body: Record<string, unknown>): Promise<Product> {
    const response = await fx.call('post', '/v1/products').send(body).expect(201);
    return productSchema.parse(response.body);
  }

  it('yönetici ürünü birimleri ve alternatif adlarıyla ekler; çalışan görür ama ekleyemez', async () => {
    const product = await createProduct({
      sku: 'PRZ-TOP-B',
      name: 'Topraklı priz, beyaz',
      baseUnit: 'adet',
      barcode: '2000000000053',
      minStock: '50',
      units: [{ unit: 'koli', factor: '50' }],
      aliases: ['priz', 'topraklı priz'],
    });
    expect(product).toMatchObject({
      sku: 'PRZ-TOP-B',
      minStock: '50.000',
      isActive: true,
      units: [{ unit: 'koli', factor: '50.000000', barcode: null }],
      aliases: ['priz', 'topraklı priz'],
    });

    const seen = await fx.call('get', `/v1/products/${product.id}`, employee).expect(200);
    expect(productSchema.parse(seen.body).id).toBe(product.id);
    const denied = await fx.call('post', '/v1/products', employee).send({ sku: 'X', name: 'X', baseUnit: 'adet' }).expect(403);
    expect(errorCode(denied.body)).toBe('ROLE_FORBIDDEN');
  });

  it('arama ad, SKU, barkod ve alternatif adda; sayfalama toplamı verir', async () => {
    await createProduct({ sku: 'KBL-NYM-325', name: 'NYM kablo 3x2,5', baseUnit: 'metre', aliases: ['yangın kablosu'] });
    // Türkçe: büyük "YANGIN" da İngilizce klavyeyle yazılan "yangin" de alternatif ad "yangın"ı bulur.
    for (const search of ['YANGIN', 'yangin']) {
      const byAlias = productListSchema.parse((await fx.call('get', `/v1/products?search=${search}`).expect(200)).body);
      expect(byAlias.items.map((item) => item.sku)).toEqual(['KBL-NYM-325']);
    }
    const bySku = productListSchema.parse((await fx.call('get', '/v1/products?search=prz-top').expect(200)).body);
    expect(bySku.items.map((item) => item.sku)).toEqual(['PRZ-TOP-B']);
    // LIKE'ın özel karakteri düz karakter olarak aranır: "%" her şeyle eşleşmez.
    const literal = productListSchema.parse((await fx.call('get', '/v1/products?search=%25').expect(200)).body);
    expect(literal.total).toBe(0);

    const page = productListSchema.parse((await fx.call('get', '/v1/products?pageSize=1&page=2').expect(200)).body);
    expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(page.items).toHaveLength(1);
  });

  it('aynı SKU ya da barkod şirket içinde ikinci kez kullanılamaz; başka şirkette kullanılabilir', async () => {
    const sku = await fx.call('post', '/v1/products').send({ sku: 'PRZ-TOP-B', name: 'Başka', baseUnit: 'adet' }).expect(409);
    expect(errorCode(sku.body)).toBe('PRODUCT_SKU_TAKEN');
    const barcode = await fx
      .call('post', '/v1/products')
      .send({ sku: 'YENI-1', name: 'Başka', baseUnit: 'adet', barcode: '2000000000053' })
      .expect(409);
    expect(errorCode(barcode.body)).toBe('PRODUCT_BARCODE_TAKEN');
    await other.call('post', '/v1/products').send({ sku: 'PRZ-TOP-B', name: 'Topraklı priz', baseUnit: 'adet' }).expect(201);
  });

  it('başka şirketin ürünü ve carisi bulunamaz ve değiştirilemez: 404', async () => {
    const foreign = productSchema.parse(
      (await other.call('post', '/v1/products').send({ sku: 'B-ONLY', name: 'B ürünü', baseUnit: 'adet' }).expect(201)).body,
    );
    expect(errorCode((await fx.call('get', `/v1/products/${foreign.id}`).expect(404)).body)).toBe('PRODUCT_NOT_FOUND');
    await fx.call('put', `/v1/products/${foreign.id}`).send({ sku: 'B-ONLY', name: 'Ele geçirildi', baseUnit: 'adet' }).expect(404);
    const after = productSchema.parse((await other.call('get', `/v1/products/${foreign.id}`).expect(200)).body);
    expect(after.name).toBe('B ürünü');

    const party = partySchema.parse(
      (await other.call('post', '/v1/parties').send({ name: 'B Tedarik', type: 'SUPPLIER' }).expect(201)).body,
    );
    await fx.call('get', `/v1/parties/${party.id}`).expect(404);
  });

  it('pasife alınan ürün varsayılan listede görünmez ve yeni işlemde kullanılamaz; silinmez', async () => {
    const product = await createProduct({ sku: 'ESKI-1', name: 'Eski ürün', baseUnit: 'adet' });
    await fx.call('put', `/v1/products/${product.id}`).send({ sku: 'ESKI-1', name: 'Eski ürün', baseUnit: 'adet', isActive: false }).expect(200);

    const active = productListSchema.parse((await fx.call('get', '/v1/products?search=ESKI').expect(200)).body);
    expect(active.total).toBe(0);
    const all = productListSchema.parse((await fx.call('get', '/v1/products?search=ESKI&status=all').expect(200)).body);
    expect(all.items.map((item) => item.isActive)).toEqual([false]);

    const operation = await fx
      .call('post', '/v1/operations')
      .send({ type: 'STOCK_IN', items: [{ productId: product.id, warehouseId: fx.main, quantity: '1' }] })
      .expect(422);
    expect(apiErrorSchema.parse(operation.body).error.details).toEqual([
      expect.objectContaining({ lineNo: 1, code: 'PRODUCT_INACTIVE' }),
    ]);
  });

  it('işlemde kullanılmış birim silinemez; hareketi olan ürünün ana birimi değişmez; katsayı değişebilir', async () => {
    const product = await createProduct({ sku: 'SGR-C16', name: 'Otomatik sigorta C16', baseUnit: 'adet', units: [{ unit: 'kutu', factor: '12' }] });
    await fx.apply('STOCK_IN', [{ productId: product.id, warehouseId: fx.main, quantity: '2', unit: 'kutu', unitCost: '120' }]);
    const base = { sku: 'SGR-C16', name: 'Otomatik sigorta C16', baseUnit: 'adet' };

    const removed = await fx.call('put', `/v1/products/${product.id}`).send({ ...base, units: [] }).expect(409);
    expect(errorCode(removed.body)).toBe('UNIT_IN_USE');
    const locked = await fx
      .call('put', `/v1/products/${product.id}`)
      .send({ ...base, baseUnit: 'paket', units: [{ unit: 'kutu', factor: '12' }] })
      .expect(409);
    expect(errorCode(locked.body)).toBe('BASE_UNIT_LOCKED');

    // Katsayı değişir; geçmiş hareket kendi katsayısını saklar (inventory_movements.unit_factor).
    const updated = await fx
      .call('put', `/v1/products/${product.id}`)
      .send({ ...base, units: [{ unit: 'kutu', factor: '10' }], aliases: ['otomat'] })
      .expect(200);
    expect(productSchema.parse(updated.body)).toMatchObject({ units: [{ unit: 'kutu', factor: '10.000000' }], aliases: ['otomat'] });
    const [movement] = await fx.db.execute<{ factor: string }>(
      sql`select unit_factor as factor from inventory_movements where product_id = ${product.id}`,
    );
    expect(movement?.factor).toBe('12.000000');
  });

  it('cari: ekleme, aynı VKN, türe göre süzme, pasife alma', async () => {
    const supplier = partySchema.parse(
      (await fx.call('post', '/v1/parties').send({ name: 'Anadolu Kablo', type: 'SUPPLIER', taxId: '9990000011' }).expect(201)).body,
    );
    await fx.call('post', '/v1/parties').send({ name: 'Yıldız Yapı', type: 'CUSTOMER' }).expect(201);
    const duplicate = await fx.call('post', '/v1/parties').send({ name: 'Kopya', type: 'SUPPLIER', taxId: '9990000011' }).expect(409);
    expect(errorCode(duplicate.body)).toBe('PARTY_TAX_ID_TAKEN');

    const suppliers = await fx.call('get', '/v1/parties?type=SUPPLIER').expect(200);
    expect((suppliers.body as { items: { name: string }[] }).items.map((item) => item.name)).toEqual(['Anadolu Kablo']);

    const deactivated = await fx
      .call('put', `/v1/parties/${supplier.id}`)
      .send({ name: 'Anadolu Kablo', type: 'SUPPLIER', taxId: '9990000011', isActive: false })
      .expect(200);
    expect(partySchema.parse(deactivated.body).isActive).toBe(false);
    await fx.call('post', '/v1/parties', employee).send({ name: 'X', type: 'SUPPLIER' }).expect(403);
    await fx.call('get', `/v1/parties/${randomUUID()}`).expect(404);
  });
});
