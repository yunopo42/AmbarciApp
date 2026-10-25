// Ürün içe aktarma gerçek veritabanında: ürünler birimleri ve adlarıyla, başlangıç stoku onay bekleyen açılış işlemi
// olarak; şirkette zaten kullanılan SKU satır numarasıyla; ya hepsi ya hiçbiri; başka şirketin deposu; satır sınırı.
// Oluşturulan her şey sonunda silinir.
import {
  apiErrorSchema,
  confirmOperationResultSchema,
  operationSchema,
  productImportResultSchema,
  productListSchema,
} from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

describe('Ürün içe aktarma (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let employee = '';

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'İçe aktarma' });
    other = await createStockFixture({ label: 'İçe aktarma B' });
    employee = await fx.addMember('EMPLOYEE');
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  const importRows = (body: object, userId?: string) => fx.call('post', '/v1/products/import', userId).send(body);
  const error = (body: unknown) => apiErrorSchema.parse(body).error;
  const productCount = async (): Promise<number> => {
    const [row] = await fx.db.execute<{ count: number }>(
      sql`select count(*)::int as count from products where organization_id = ${fx.org}`,
    );
    return row?.count ?? -1;
  };

  it('ürünler birimleri ve adlarıyla eklenir; başlangıç stoku onay bekler, stok yalnızca onayla değişir', async () => {
    const response = await importRows({
      warehouseId: fx.main,
      rows: [
        {
          row: 2,
          product: {
            sku: 'PRZ-IMP',
            name: 'Topraklı priz',
            baseUnit: 'adet',
            barcode: '2000000000077',
            minStock: '50',
            units: [{ unit: 'koli', factor: '12' }],
            aliases: ['priz', 'grup priz'],
          },
          openingQuantity: '120',
          openingUnitCost: '10',
        },
        { row: 3, product: { sku: 'KBL-IMP', name: 'NYM kablo 3x2,5', baseUnit: 'metre' } },
      ],
    }).expect(201);
    const result = productImportResultSchema.parse(response.body);
    expect(result.created).toBe(2);
    expect(result.openingOperationIds).toHaveLength(1);

    const list = productListSchema.parse((await fx.call('get', '/v1/products?search=imp').expect(200)).body);
    expect(list.items.find((item) => item.sku === 'PRZ-IMP')).toMatchObject({
      units: [{ unit: 'koli', factor: '12.000000' }],
      aliases: ['grup priz', 'priz'],
      minStock: '50.000',
    });

    // İçe aktarma stoğa dokunmaz: açılış işlemi onay bekliyor.
    const [operationId] = result.openingOperationIds;
    const operation = operationSchema.parse((await fx.call('get', `/v1/operations/${operationId}`).expect(200)).body);
    expect(operation).toMatchObject({ type: 'OPENING', status: 'PENDING_CONFIRMATION', source: 'IMPORT' });
    const productId = operation.items[0]?.productId ?? '';
    expect(await fx.stockOf(fx.main, productId)).toBeNull();

    const confirmed = confirmOperationResultSchema.parse((await fx.confirm(operation).expect(200)).body);
    expect(confirmed.movements[0]).toMatchObject({ quantityAfter: '120.000', averageCostAfter: '10.0000' });
  });

  it('şirkette zaten kullanılan SKU ve barkod satır numarasıyla döner; hiçbir satır kaydedilmez', async () => {
    const before = await productCount();
    const response = await importRows({
      rows: [
        { row: 2, product: { sku: 'YENI-1', name: 'Yeni ürün', baseUnit: 'adet' } },
        { row: 3, product: { sku: 'PRZ-IMP', name: 'Aynı SKU', baseUnit: 'adet' } },
        { row: 4, product: { sku: 'YENI-2', name: 'Aynı barkod', baseUnit: 'adet', barcode: '2000000000077' } },
      ],
    }).expect(422);
    expect(error(response.body)).toMatchObject({
      code: 'IMPORT_ROWS_INVALID',
      details: [
        { row: 3, field: 'product.sku', message: 'Bu SKU şirkette başka bir üründe kullanılıyor.' },
        { row: 4, field: 'product.barcode', message: 'Bu barkod şirkette başka bir üründe kullanılıyor.' },
      ],
    });
    expect(await productCount()).toBe(before);
  });

  it('başka şirketin deposuna başlangıç stoku girilemez; ürünler de kaydedilmez. Başka şirketteki aynı SKU serbest', async () => {
    const before = await productCount();
    const response = await importRows({
      warehouseId: other.main,
      rows: [{ row: 2, product: { sku: 'DEPO-1', name: 'Depo denemesi', baseUnit: 'adet' }, openingQuantity: '5' }],
    }).expect(422);
    expect(error(response.body).code).toBe('IMPORT_WAREHOUSE_INVALID');
    expect(await productCount()).toBe(before);

    // Kodlar şirket içinde benzersiz: başka şirketin SKU'su bu şirkette kullanılabilir.
    await other.call('post', '/v1/products').send({ sku: 'B-SKU', name: 'B ürünü', baseUnit: 'adet' }).expect(201);
    await importRows({ rows: [{ row: 2, product: { sku: 'B-SKU', name: 'A ürünü', baseUnit: 'adet' } }] }).expect(201);
  });

  it('çalışan içe aktaramaz; 1.000 satırdan fazlası reddedilir', async () => {
    const denied = await importRows({ rows: [{ row: 2, product: { sku: 'X', name: 'X', baseUnit: 'adet' } }] }, employee).expect(
      403,
    );
    expect(error(denied.body).code).toBe('ROLE_FORBIDDEN');

    const tooMany = Array.from({ length: 1001 }, (_, index) => ({
      row: index + 2,
      product: { sku: `LIM-${index}`, name: `Ürün ${index}`, baseUnit: 'adet' },
    }));
    const rejected = await importRows({ rows: tooMany }).expect(400);
    expect(error(rejected.body).code).toBe('VALIDATION_FAILED');
  });

  it('1.000 satır (gövde 100 KB üstü) tek seferde eklenir; başlangıç stoku 100 kalemlik işlemlere bölünür', async () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({
      row: index + 2,
      product: {
        sku: `TOPLU-${String(index).padStart(4, '0')}`,
        name: `Toplu içe aktarma deneme ürünü, uzun ad ${index}`,
        baseUnit: 'adet',
        units: [{ unit: 'koli', factor: '24' }],
        aliases: [`toplu ${index}`],
      },
      openingQuantity: '1',
    }));
    expect(JSON.stringify({ warehouseId: fx.main, rows }).length).toBeGreaterThan(100 * 1024);

    const result = productImportResultSchema.parse((await importRows({ warehouseId: fx.main, rows }).expect(201)).body);
    expect(result.created).toBe(1000);
    expect(result.openingOperationIds).toHaveLength(10);
  });
});
