// Araç kayıt defteri, veritabanı olmadan: modele giden strict şemalar, yetki kuralı, girdi doğrulaması, hata
// sonuçları ve araç çıktılarının biçimi. Araçların SQL tarafı test-db/assistant-tools.db.spec.ts'te.
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { createReadTools } from '../src/modules/assistant/tools/read-tools.js';
import { defineTool, ToolRegistry } from '../src/modules/assistant/tools/registry.js';
import { adminContext, BRANCH, employeeContext, fakeReadServices, MAIN, PRODUCT } from './support/assistant-fakes.js';

function registry(): { registry: ToolRegistry; calls: ReturnType<typeof fakeReadServices>['calls'] } {
  const { services, calls } = fakeReadServices();
  return { registry: new ToolRegistry(createReadTools(services)), calls };
}

/** Şemada strict modun desteklemediği bir anahtar var mı (iç içe her düzeyde). */
function unsupportedKeys(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => unsupportedKeys(item, found));
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (['$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'default'].includes(key)) {
        found.push(key);
      }
      unsupportedKeys(value, found);
    }
  }
  return found;
}

describe('Araç kayıt defteri: tanımlar', () => {
  it('modele dört okuma aracı sabit sırayla gider; strict şemalar desteklenmeyen kural içermez', () => {
    const definitions = registry().registry.definitions();
    expect(definitions.map((tool) => tool.name)).toEqual(['search_products', 'list_warehouses', 'get_stock', 'list_recent_movements']);
    for (const tool of definitions) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      expect(unsupportedKeys(tool.inputSchema), tool.name).toEqual([]);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('şemalar packages/shared Zod şemalarından üretilir: isteğe bağlı alanlar required değil, uuid biçimi korunur', () => {
    const byName = Object.fromEntries(registry().registry.definitions().map((tool) => [tool.name, tool.inputSchema]));
    expect(byName.search_products).toMatchObject({ properties: { query: { type: 'string' } }, required: ['query'] });
    expect(byName.get_stock).toMatchObject({
      properties: { product_id: { type: 'string', format: 'uuid' }, warehouse_id: { type: 'string', format: 'uuid' } },
      required: ['product_id'],
    });
    expect(byName.list_recent_movements).toMatchObject({ properties: { limit: { type: 'integer' } }, required: ['product_id'] });
    expect(byName.list_warehouses).toEqual({ type: 'object', properties: {}, required: [], additionalProperties: false });
  });

  it('onaylayan ya da stok yazan araç kayıt defterine eklenemez (mimari değişmez 2)', () => {
    const confirm = defineTool({
      name: 'confirm_operation',
      description: 'Bu araç olmamalı.',
      statusLabel: '—',
      toolClass: 'propose',
      allowedRoles: ['ADMIN'],
      input: z.strictObject({}),
      run: async () => ({}),
    });
    expect(() => new ToolRegistry([confirm])).toThrow(/onaylayan ya da stok yazan/);
  });
});

describe('Araç kayıt defteri: çalıştırma', () => {
  it('bilinmeyen araç modele hata olarak döner', async () => {
    expect(await registry().registry.execute('apply_stock', {}, adminContext)).toEqual({
      isError: true,
      content: 'Bilinmeyen araç: apply_stock. Yalnızca tanımlı araçları kullan.',
    });
  });

  it('şemaya uymayan girdi çalıştırılmaz; hata modele nedeniyle döner', async () => {
    const { registry: tools, calls } = registry();
    const notUuid = await tools.execute('get_stock', { product_id: 'KBL-NYM-25' }, adminContext);
    expect(notUuid.isError).toBe(true);
    expect(notUuid.content).toMatch(/product_id: .*search_products ile bulun/);
    expect(await tools.execute('list_recent_movements', { product_id: PRODUCT, limit: 500 }, adminContext)).toMatchObject({
      isError: true,
      content: expect.stringMatching(/limit en fazla 20/),
    });
    expect(calls.productStock).toBe(0);
  });

  it('şirket kimliği araç girdisinden alınamaz: fazladan alan reddedilir (mimari değişmez 5)', async () => {
    const { registry: tools, calls } = registry();
    const result = await tools.execute('get_stock', { product_id: PRODUCT, organization_id: crypto.randomUUID() }, adminContext);
    expect(result.isError).toBe(true);
    expect(calls.productStock).toBe(0);
  });

  it('rolün izni yoksa araç çalışmaz', async () => {
    const adminOnly = defineTool({
      name: 'admin_report',
      description: 'Yalnızca yöneticinin kullanabildiği deneme aracı.',
      statusLabel: 'Rapor hazırlanıyor',
      toolClass: 'read',
      allowedRoles: ['ADMIN'],
      input: z.strictObject({}),
      run: async () => ({ ok: true }),
    });
    const tools = new ToolRegistry([adminOnly]);
    expect(await tools.execute('admin_report', {}, employeeContext)).toEqual({
      isError: true,
      content: 'Kullanıcının bu aracı kullanma yetkisi yok.',
    });
    expect(await tools.execute('admin_report', {}, adminContext)).toEqual({ isError: false, content: '{"ok":true}' });
  });

  it('servisin Türkçe hatası modele aynen, beklenmeyen hata genel mesajla döner', async () => {
    expect(await registry().registry.execute('get_stock', { product_id: crypto.randomUUID() }, adminContext)).toEqual({
      isError: true,
      content: 'Ürün bulunamadı.',
    });
    const broken = defineTool({
      name: 'broken',
      description: 'Her zaman beklenmeyen hata veren deneme aracı.',
      statusLabel: '—',
      toolClass: 'read',
      allowedRoles: ['ADMIN'],
      input: z.strictObject({}),
      run: async () => {
        throw new Error('bağlantı koptu: postgres://gizli');
      },
    });
    expect(await new ToolRegistry([broken]).execute('broken', {}, adminContext)).toEqual({
      isError: true,
      content: 'Araç çalışırken beklenmeyen bir hata oluştu.',
    });
  });
});

describe('Okuma araçlarının çıktısı', () => {
  it('get_stock: miktarlar Türkçe yazımla; yönetici bütün depoları ve toplamı görür', async () => {
    const result = await registry().registry.execute('get_stock', { product_id: PRODUCT }, adminContext);
    expect(JSON.parse(result.content)).toEqual({
      product_id: PRODUCT,
      base_unit: 'metre',
      min_stock: '50',
      total: '1.452,5',
      warehouses: [
        { warehouse_id: MAIN, name: 'Merkez Depo', type: 'Depo', quantity: '1.412,5', below_min_stock: false },
        { warehouse_id: BRANCH, name: 'Araç 1', type: 'Araç', quantity: '40', below_min_stock: true },
      ],
    });
  });

  it('get_stock: çalışan yalnızca yetkili deposunu görür; yetkisiz depoyu soramaz', async () => {
    const { registry: tools, calls } = registry();
    const own = JSON.parse((await tools.execute('get_stock', { product_id: PRODUCT }, employeeContext)).content) as {
      total: string;
      warehouses: unknown[];
    };
    expect(own.total).toBe('1.412,5');
    expect(own.warehouses).toHaveLength(1);

    const before = calls.productStock;
    expect(await tools.execute('get_stock', { product_id: PRODUCT, warehouse_id: BRANCH }, employeeContext)).toEqual({
      isError: true,
      content: 'Kullanıcının bu depoyu görme yetkisi yok.',
    });
    expect(calls.productStock).toBe(before);
  });

  it('get_stock: tek depo sorulursa toplam o deponun miktarıdır', async () => {
    const result = JSON.parse((await registry().registry.execute('get_stock', { product_id: PRODUCT, warehouse_id: BRANCH }, adminContext)).content) as {
      total: string;
      warehouses: { name: string }[];
    };
    expect(result.total).toBe('40');
    expect(result.warehouses.map((row) => row.name)).toEqual(['Araç 1']);
  });

  it('list_recent_movements: tarih Türkiye saatiyle, tür Türkçe, miktar işaretli', async () => {
    const result = await registry().registry.execute('list_recent_movements', { product_id: PRODUCT }, adminContext);
    expect(JSON.parse(result.content)).toEqual({
      product_id: PRODUCT,
      total: 1,
      movements: [{ date: '05.11.2026 14:32', warehouse: 'Merkez Depo', type: 'Çıkış', quantity_change: '−12,5', quantity_after: '1.412,5' }],
    });
  });

  it('list_warehouses: pasif depo listelenmez; çalışan yalnızca yetkili olduğu depoyu görür', async () => {
    const tools = registry().registry;
    const forAdmin = JSON.parse((await tools.execute('list_warehouses', {}, adminContext)).content) as { warehouses: { name: string }[] };
    expect(forAdmin.warehouses.map((warehouse) => warehouse.name)).toEqual(['Merkez Depo', 'Araç 1']);
    const forEmployee = JSON.parse((await tools.execute('list_warehouses', {}, employeeContext)).content) as {
      warehouses: unknown[];
    };
    expect(forEmployee.warehouses).toEqual([{ warehouse_id: MAIN, name: 'Merkez Depo', type: 'Depo' }]);
  });

  it('search_products: adaylar skor ve eşleşen alternatif adla döner', async () => {
    const { registry: tools, calls } = registry();
    const result = JSON.parse((await tools.execute('search_products', { query: '  kabllo nym ' }, adminContext)).content) as unknown;
    expect(result).toEqual({
      candidates: [{ product_id: PRODUCT, sku: 'KBL-NYM-25', name: 'NYM kablo 3x2,5 mm²', base_unit: 'metre', score: 0.833, matched_alias: null }],
    });
    // Zod şeması boşlukları kırpar.
    expect(calls.search).toEqual(['kabllo nym']);
  });
});
