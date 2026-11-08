// Araç kayıt defteri, veritabanı olmadan: modele giden strict şemalar, yetki kuralı, girdi doğrulaması, hata
// sonuçları ve araç çıktılarının biçimi. Araçların SQL tarafı test-db/assistant-tools.db.spec.ts ve
// test-db/propose-tools.db.spec.ts'te.
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ALL_CHAT_PROMPTS } from '../src/modules/ai/prompts/index.js';
import { defineTool, ToolRegistry } from '../src/modules/assistant/tools/registry.js';
import type { ToolContext } from '../src/modules/assistant/tools/registry.js';
import { adminContext, BRANCH, employeeContext, fullRegistry, MAIN, PARTY, PRODUCT } from './support/assistant-fakes.js';
import type { ProposalCall } from './support/assistant-fakes.js';

function registry(): {
  registry: ToolRegistry;
  calls: ReturnType<typeof fullRegistry>['readCalls'];
  proposals: ProposalCall[];
} {
  const { registry: tools, readCalls, proposals } = fullRegistry();
  return { registry: tools, calls: readCalls, proposals };
}

const V1_TOOLS = ['search_products', 'list_warehouses', 'get_stock', 'list_recent_movements'];
const PROPOSE_TOOLS = ['propose_stock_in', 'propose_stock_out', 'propose_transfer', 'propose_count', 'propose_waste'];

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
  it('sabit sıra: önce okuma, sonra öneri araçları; strict şemalar desteklenmeyen kural içermez', () => {
    const definitions = registry().registry.definitions();
    expect(definitions.map((tool) => tool.name)).toEqual([...V1_TOOLS, 'search_parties', ...PROPOSE_TOOLS]);
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

  it('her prompt sürümünün araçları kayıt defterinde; chat-v1 4. haftanın dört aracıyla aynı sırada kalır', () => {
    const tools = registry().registry;
    for (const prompt of ALL_CHAT_PROMPTS) {
      expect(tools.definitions(prompt.tools).map((tool) => tool.name), prompt.version).toEqual([...prompt.tools]);
    }
    expect(tools.definitions(ALL_CHAT_PROMPTS.find((prompt) => prompt.version === 'chat-v1')?.tools).map((tool) => tool.name)).toEqual(V1_TOOLS);
    expect(() => tools.definitions(['search_products', 'confirm_operation'])).toThrow(/Kayıt defterinde olmayan araç: confirm_operation/);
  });

  it('öneri araçları "propose" sınıfında; hiçbir sürümde onaylayan ya da uygulayan araç yok', () => {
    const tools = registry().registry;
    expect(PROPOSE_TOOLS.map((name) => tools.toolClass(name))).toEqual(PROPOSE_TOOLS.map(() => 'propose'));
    expect([...V1_TOOLS, 'search_parties'].map((name) => tools.toolClass(name))).toEqual(Array(5).fill('read'));
    for (const prompt of ALL_CHAT_PROMPTS) {
      expect(prompt.tools.filter((name) => /^(confirm|apply)_/.test(name)), prompt.version).toEqual([]);
    }
  });

  it('öneri şemaları: şirket ya da kullanıcı alanı yok, kalemler de strict; düzenleme için isteğe bağlı operation_id', () => {
    const byName = Object.fromEntries(registry().registry.definitions().map((tool) => [tool.name, tool.inputSchema]));
    expect(byName.propose_stock_out).toMatchObject({
      required: ['warehouse_id', 'lines'],
      properties: {
        operation_id: { type: 'string', format: 'uuid' },
        party_id: { type: 'string', format: 'uuid' },
        lines: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['product_id', 'quantity'] },
        },
      },
    });
    expect(byName.propose_transfer).toMatchObject({ required: ['source_warehouse_id', 'target_warehouse_id', 'lines'] });
    expect(byName.propose_count).toMatchObject({
      properties: { lines: { items: { required: ['product_id', 'counted_quantity'] } } },
    });
    expect(byName.propose_stock_in).toMatchObject({ properties: { lines: { items: { properties: { unit_cost: { type: 'string' } } } } } });
    for (const name of PROPOSE_TOOLS) {
      const schema = byName[name] as { properties: Record<string, unknown> };
      expect(Object.keys(schema.properties).filter((key) => /organization|user/.test(key)), name).toEqual([]);
    }
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

  it('sürümün listesinde olmayan araç (ör. chat-v1 sohbetinde öneri aracı) bilinmeyen araç gibi reddedilir', async () => {
    const { registry: tools, proposals } = registry();
    const input = { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '2' }] };
    expect(await tools.execute('propose_stock_out', input, adminContext, V1_TOOLS)).toEqual({
      isError: true,
      content: 'Bilinmeyen araç: propose_stock_out. Yalnızca tanımlı araçları kullan.',
    });
    expect(proposals).toEqual([]);
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

  it('search_parties: cari adla bulunur, tür Türkçe; türle süzülür', async () => {
    const tools = registry().registry;
    const found = JSON.parse((await tools.execute('search_parties', { query: 'yıldız' }, adminContext)).content) as unknown;
    expect(found).toEqual({ candidates: [{ party_id: PARTY, name: 'Yıldız Yapı İnşaat', type: 'Müşteri' }] });
    const suppliers = JSON.parse((await tools.execute('search_parties', { query: 'yıldız', type: 'SUPPLIER' }, adminContext)).content) as {
      candidates: unknown[];
    };
    expect(suppliers.candidates).toEqual([]);
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

describe('Öneri araçları (#74)', () => {
  const messageContext: ToolContext = { ...adminContext, messageId: crypto.randomUUID() };

  async function propose(
    name: string,
    input: unknown,
    context: ToolContext = messageContext,
  ): Promise<{ outcome: { isError: boolean; content: string }; proposals: ProposalCall[]; result: Record<string, unknown> | null }> {
    const tools = registry();
    const outcome = await tools.registry.execute(name, input, context);
    return {
      outcome,
      proposals: tools.proposals,
      result: outcome.isError ? null : (JSON.parse(outcome.content) as Record<string, unknown>),
    };
  }

  it('çıkış önerisi: işlem kaynak CHAT ve cevaplanan mesajla açılır; girdi işlem isteğine çevrilir', async () => {
    const { outcome, proposals } = await propose('propose_stock_out', {
      warehouse_id: MAIN,
      party_id: PARTY,
      note: 'Yıldız Yapı şantiyesi',
      lines: [{ product_id: PRODUCT, quantity: '2', unit: 'koli' }],
    });
    expect(outcome.isError, outcome.content).toBe(false);
    expect(proposals).toEqual([
      {
        kind: 'create',
        actor: { kind: 'user', userId: adminContext.userId, role: 'ADMIN' },
        source: 'CHAT',
        sourceMessageId: messageContext.messageId,
        input: {
          type: 'STOCK_OUT',
          partyId: PARTY,
          note: 'Yıldız Yapı şantiyesi',
          items: [{ productId: PRODUCT, warehouseId: MAIN, quantity: '2', unit: 'koli' }],
        },
      },
    ]);
  });

  it('modele kartın bilgileri döner: Türkçe miktarlar, ana birim karşılığı, önce → sonra, onay bekliyor', async () => {
    const { result } = await propose('propose_stock_out', {
      warehouse_id: MAIN,
      party_id: PARTY,
      lines: [{ product_id: PRODUCT, quantity: '2', unit: 'koli' }],
    });
    expect(result).toMatchObject({
      version: 1,
      type: 'Çıkış',
      status: 'Onay bekliyor',
      party: 'Yıldız Yapı İnşaat',
      insufficient_stock: false,
      lines: [
        {
          product: 'NYM kablo 3x2,5 mm²',
          sku: 'KBL-NYM-25',
          quantity: '2 koli',
          base_quantity: '200 metre',
          warehouse: 'Merkez Depo',
          stock_change: '1.412,5 metre → 1.212,5 metre',
          sufficient: true,
        },
      ],
    });
    expect(String(result?.next_step)).toMatch(/stok henüz değişmedi/i);
    expect(typeof result?.operation_id).toBe('string');
  });

  it('transfer iki depoyu kalemlere yazar; giriş birim maliyetini, sayım sayılan miktarı taşır', async () => {
    const transfer = await propose('propose_transfer', {
      source_warehouse_id: MAIN,
      target_warehouse_id: BRANCH,
      lines: [{ product_id: PRODUCT, quantity: '200' }],
    });
    expect(transfer.proposals[0]?.input.items).toEqual([{ productId: PRODUCT, warehouseId: MAIN, targetWarehouseId: BRANCH, quantity: '200' }]);
    expect(transfer.result?.lines).toEqual([expect.objectContaining({ target_warehouse: 'Araç 1', target_stock_change: '0 metre → 200 metre' })]);

    const stockIn = await propose('propose_stock_in', {
      warehouse_id: MAIN,
      lines: [{ product_id: PRODUCT, quantity: '3', unit: 'koli', unit_cost: '1200' }],
    });
    expect(stockIn.proposals[0]?.input.items[0]).toMatchObject({ unit: 'koli', unitCost: '1200' });
    expect(stockIn.result?.lines).toEqual([expect.objectContaining({ unit_cost: '1.200 TL / koli' })]);

    const count = await propose('propose_count', { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, counted_quantity: '0' }] });
    expect(count.outcome.isError, count.outcome.content).toBe(false);
    expect(count.proposals[0]?.input).toMatchObject({ type: 'COUNT', items: [{ quantity: '0' }] });
    expect(count.result?.lines).toEqual([expect.objectContaining({ counted_quantity: '0 metre' })]);

    const waste = await propose('propose_waste', { warehouse_id: MAIN, note: 'kırık geldi', lines: [{ product_id: PRODUCT, quantity: '1' }] });
    expect(waste.proposals[0]?.input).toMatchObject({ type: 'WASTE', note: 'kırık geldi' });
  });

  it('operation_id verilirse yeni işlem açılmaz, aynı öneri düzenlenir ve sürüm artar', async () => {
    const tools = registry();
    const opened = await tools.registry.execute(
      'propose_stock_out',
      { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '2', unit: 'koli' }] },
      messageContext,
    );
    const first = JSON.parse(opened.content) as { operation_id: string };
    const revised = await tools.registry.execute(
      'propose_stock_out',
      { operation_id: first.operation_id, warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '3', unit: 'koli' }] },
      messageContext,
    );
    expect(revised.isError, revised.content).toBe(false);
    expect(JSON.parse(revised.content)).toMatchObject({ operation_id: first.operation_id, version: 2, lines: [{ quantity: '3 koli' }] });
    expect(tools.proposals.map((call) => [call.kind, call.operationId ?? null])).toEqual([
      ['create', null],
      ['revise', first.operation_id],
    ]);
  });

  it('işlem kuralları araçta da geçerli: transferde aynı depo, sayımda aynı ürün iki kez, sıfır miktar', async () => {
    const sameWarehouse = await propose('propose_transfer', {
      source_warehouse_id: MAIN,
      target_warehouse_id: MAIN,
      lines: [{ product_id: PRODUCT, quantity: '5' }],
    });
    expect(sameWarehouse.outcome).toEqual({ isError: true, content: 'Öneri geçersiz: Kalem 1: Hedef depo, çıkış deposundan farklı olmalı.' });
    const twice = await propose('propose_count', {
      warehouse_id: MAIN,
      lines: [
        { product_id: PRODUCT, counted_quantity: '5' },
        { product_id: PRODUCT, counted_quantity: '6' },
      ],
    });
    expect(twice.outcome.content).toMatch(/Kalem 2: Bu ürün bu depoda zaten sayıldı/);
    const zero = await propose('propose_stock_out', { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '0' }] });
    expect(zero.outcome.content).toMatch(/Kalem 1: Miktar sıfırdan büyük olmalı/);
    expect([...sameWarehouse.proposals, ...twice.proposals, ...zero.proposals]).toEqual([]);
  });

  it('şemaya uymayan girdi çalışmaz: fazladan organization_id, virgüllü miktar, kalemsiz öneri', async () => {
    const extra = await propose('propose_stock_out', {
      organization_id: crypto.randomUUID(),
      warehouse_id: MAIN,
      lines: [{ product_id: PRODUCT, quantity: '2' }],
    });
    expect(extra.outcome.isError).toBe(true);
    const comma = await propose('propose_stock_out', { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '2,5' }] });
    expect(comma.outcome.content).toMatch(/lines\.0\.quantity: Miktar en fazla 11 tam/);
    const empty = await propose('propose_stock_out', { warehouse_id: MAIN, lines: [] });
    expect(empty.outcome.content).toMatch(/En az bir kalem gerekli/);
    expect([...extra.proposals, ...comma.proposals, ...empty.proposals]).toEqual([]);
  });

  it('kalem hatası modele hangi kalemin neden geçersiz olduğuyla döner; bulunamayan birimde ürünün birimleri söylenir', async () => {
    const unit = await propose('propose_stock_out', { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '2', unit: 'makara' }] });
    expect(unit.outcome).toEqual({
      isError: true,
      content: 'İşlemin bazı kalemleri geçersiz. Kalem 1: Ürünün bu birimi yok. Ürünün birimleri: metre (ana birim), koli (1 koli = 100 metre).',
    });
    const otherCompany = await propose('propose_stock_out', { warehouse_id: MAIN, lines: [{ product_id: crypto.randomUUID(), quantity: '2' }] });
    expect(otherCompany.outcome).toEqual({ isError: true, content: 'İşlemin bazı kalemleri geçersiz. Kalem 1: Ürün bulunamadı.' });
  });

  it('stok yetmeyen kalemde modele eksi "sonra" değeri gitmez: eldeki ve gereken miktar, onaylanamayacağı söylenir', async () => {
    const { outcome, result } = await propose('propose_stock_out', { warehouse_id: MAIN, lines: [{ product_id: PRODUCT, quantity: '5000' }] });
    expect(outcome.isError, outcome.content).toBe(false);
    expect(result).toMatchObject({
      insufficient_stock: true,
      lines: [
        {
          sufficient: false,
          available: '1.412,5 metre',
          required: '5.000 metre',
          problem: 'Stok yetmiyor (Merkez Depo): 1.412,5 metre var, 5.000 metre gerekiyor. Bu kalem bu hâliyle onaylanamaz.',
        },
      ],
    });
    expect(result?.lines).toEqual([expect.not.objectContaining({ stock_change: expect.anything() })]);
    expect(String(result?.next_step)).toMatch(/onaylanamaz, onay reddedilir ve stok eksiye düşmez/);
    // #74 denemesinde model "onaylanırsa stok −5 adet olur" demişti: eksi miktar modele hiç verilmez.
    expect(outcome.content).not.toMatch(/[−-]\d[\d.,]*\s(metre|adet|koli)/);
  });

  it('çalışan yetkisi olmayan depoda öneri açamaz; servisin Türkçe hatası modele döner', async () => {
    const { outcome } = await propose(
      'propose_stock_out',
      { warehouse_id: BRANCH, lines: [{ product_id: PRODUCT, quantity: '2' }] },
      { ...employeeContext, messageId: crypto.randomUUID() },
    );
    expect(outcome).toEqual({ isError: true, content: 'Bu depoda işlem yetkiniz yok.' });
  });
});
