// Asistanın öneri araçları gerçek veritabanında (#74): araç işlemi onay bekleyen olarak, kaynak CHAT ve cevaplanan
// mesajla açar; stok, hareket, maliyet ve outbox değişmez. Stok yalnızca kartın onayıyla (onay uç noktası) bir kez
// değişir. Düzenleme sürümü artırır ve eski sürümün onayını geçersiz kılar. Çalışanın depo yetkisi, başka şirketin
// ürünü, birim çevrimi ve source_message_id kısıtları denetlenir. Model çağrılmaz: araçlar kayıt defterinden, API'nin
// gerçek servisleriyle çalıştırılır. Oluşturulan her şey sonunda silinir.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Operation } from '@ambarci/shared';

import { postgresErrorOf } from '../src/common/postgres-error.js';
import { ToolRegistry } from '../src/modules/assistant/tools/registry.js';
import type { ToolContext } from '../src/modules/assistant/tools/registry.js';
import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

/** Onay isteği yalnızca işlemin kimliğini ve kartın gösterdiği sürümü kullanır. */
function card(id: string, version: number): Operation {
  return { id, version } as Operation;
}

/** Sorgunun PostgreSQL hatası (kod ve kısıt adı); hata yoksa boş. */
async function violation(query: PromiseLike<unknown>): Promise<{ code?: string; constraint?: string }> {
  return postgresErrorOf(await Promise.resolve(query).then(() => null, (error: unknown) => error));
}

interface Proposal {
  operation_id: string;
  version: number;
  type: string;
  status: string;
  party: string | null;
  lines: { quantity?: string; base_quantity?: string; stock_change: string | null; sufficient: boolean }[];
}

describe('Asistanın öneri araçları (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let tools: ToolRegistry;
  let admin: ToolContext;
  let employee: ToolContext;
  let employeeId = '';
  const cable = randomUUID();
  const customer = randomUUID();
  let otherProduct = '';
  let otherMessage = '';

  /** Kullanıcının sohbetine bir kullanıcı mesajı ekler; öneri bu mesajı cevaplıyormuş gibi bağlanır. */
  async function userMessage(userId: string, position = 1): Promise<string> {
    const conversation = randomUUID();
    const message = randomUUID();
    await fx.db.execute(sql`insert into conversations (id, organization_id, user_id) values (${conversation}, ${fx.org}, ${userId})`);
    await fx.db.execute(sql`insert into messages (id, organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
      values (${message}, ${fx.org}, ${conversation}, ${userId}, ${position}, 'USER',
              ${JSON.stringify([{ type: 'text', text: 'Merkezden 2 koli kablo çıkışı yap' }])}::jsonb, ${randomUUID()}, 'IN_PROGRESS')`);
    return message;
  }

  async function propose(name: string, input: unknown, context: ToolContext): Promise<Proposal> {
    const outcome = await tools.execute(name, input, context);
    expect(outcome.isError, outcome.content).toBe(false);
    return JSON.parse(outcome.content) as Proposal;
  }

  async function counts(): Promise<{ operations: number; movements: number; events: number; inventoryRows: number }> {
    const [row] = await fx.db.execute<{ operations: number; movements: number; events: number; inventoryRows: number }>(sql`
      select (select count(*)::int from operations where organization_id = ${fx.org}) as operations,
             (select count(*)::int from inventory_movements where organization_id = ${fx.org}) as movements,
             (select count(*)::int from outbox_events where organization_id = ${fx.org}) as events,
             (select count(*)::int from inventory where organization_id = ${fx.org}) as "inventoryRows"`);
    if (!row) {
      throw new Error('Sayım okunamadı.');
    }
    return row;
  }

  async function operationRow(id: string): Promise<{ status: string; source: string; version: number; sourceMessageId: string | null } | undefined> {
    const [row] = await fx.db.execute<{ status: string; source: string; version: number; sourceMessageId: string | null }>(sql`
      select status, source, version, source_message_id as "sourceMessageId" from operations where id = ${id}`);
    return row;
  }

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Öneri araçları' });
    other = await createStockFixture({ label: 'Öneri araçları B' });
    tools = fx.app.get(ToolRegistry, { strict: false });

    await fx.db.execute(sql`insert into products (id, organization_id, sku, name, base_unit) values
      (${cable}, ${fx.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre')`);
    await fx.db.execute(sql`insert into product_units (organization_id, product_id, unit, factor) values
      (${fx.org}, ${cable}, 'koli', '100')`);
    await fx.db.execute(sql`insert into parties (id, organization_id, name, type) values
      (${customer}, ${fx.org}, 'Yıldız Yapı İnşaat', 'CUSTOMER')`);
    otherProduct = randomUUID();
    await other.db.execute(sql`insert into products (id, organization_id, sku, name, base_unit)
      values (${otherProduct}, ${other.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre')`);
    // Başka şirketin mesajı: işlem ona bağlanamamalı.
    const otherConversation = randomUUID();
    otherMessage = randomUUID();
    await other.db.execute(sql`insert into conversations (id, organization_id, user_id) values (${otherConversation}, ${other.org}, ${other.admin})`);
    await other.db.execute(sql`insert into messages (id, organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
      values (${otherMessage}, ${other.org}, ${otherConversation}, ${other.admin}, 1, 'USER',
              ${JSON.stringify([{ type: 'text', text: 'x' }])}::jsonb, ${randomUUID()}, 'COMPLETED')`);

    // Çalışan yalnızca Merkez'de yetkili.
    employeeId = await fx.addMember('EMPLOYEE');
    const memberships = await fx.db.execute<{ id: string; userId: string }>(sql`
      select id, user_id as "userId" from organization_users where organization_id = ${fx.org}`);
    const membershipOf = (userId: string): string => memberships.find((row) => row.userId === userId)?.id ?? '';
    await fx.db.execute(sql`insert into user_warehouse_access (organization_id, organization_user_id, warehouse_id)
      values (${fx.org}, ${membershipOf(employeeId)}, ${fx.main})`);
    admin = { organization: { id: fx.org, role: 'ADMIN', membershipId: membershipOf(fx.admin) }, userId: fx.admin };
    employee = { organization: { id: fx.org, role: 'EMPLOYEE', membershipId: membershipOf(employeeId) }, userId: employeeId };

    // Merkez'de 1.000 metre kablo.
    await fx.apply('STOCK_IN', [{ productId: cable, warehouseId: fx.main, quantity: '10', unit: 'koli', unitCost: '1000' }]);
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  it('öneri onay bekleyen işlem açar (kaynak CHAT, cevaplanan mesaj); stok, hareket ve outbox değişmez', async () => {
    const messageId = await userMessage(fx.admin);
    const before = await counts();
    const stockBefore = await fx.stockOf(fx.main, cable);

    const proposal = await propose(
      'propose_stock_out',
      { warehouse_id: fx.main, party_id: customer, lines: [{ product_id: cable, quantity: '2', unit: 'koli' }] },
      { ...admin, messageId },
    );

    expect(proposal).toMatchObject({
      version: 1,
      type: 'Çıkış',
      status: 'Onay bekliyor',
      party: 'Yıldız Yapı İnşaat',
      lines: [{ quantity: '2 koli', base_quantity: '200 metre', stock_change: '1.000 metre → 800 metre', sufficient: true }],
    });
    expect(await operationRow(proposal.operation_id)).toEqual({
      status: 'PENDING_CONFIRMATION',
      source: 'CHAT',
      version: 1,
      sourceMessageId: messageId,
    });
    const after = await counts();
    expect(after).toEqual({ ...before, operations: before.operations + 1 });
    expect(await fx.stockOf(fx.main, cable)).toEqual(stockBefore);
    expect(await fx.writtenFor(proposal.operation_id)).toEqual({ movements: 0, audits: 0, events: 0 });
    const [audit] = await fx.db.execute<{ source: string }>(sql`
      select source from audit_logs where entity_id = ${proposal.operation_id} and action = 'operation.created'`);
    expect(audit?.source).toBe('CHAT');
  });

  it('stok yalnızca kartın onayıyla değişir, bir kez: aynı anahtarla tekrar gelen onay stoğu yeniden değiştirmez', async () => {
    const proposal = await propose(
      'propose_stock_out',
      { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '50' }] },
      { ...admin, messageId: await userMessage(fx.admin) },
    );
    expect((await fx.stockOf(fx.main, cable))?.quantity).toBe('1000.000');
    const key = randomUUID();
    await fx.confirm(card(proposal.operation_id, proposal.version), key).expect(200);
    await fx.confirm(card(proposal.operation_id, proposal.version), key).expect(200);

    expect((await fx.stockOf(fx.main, cable))?.quantity).toBe('950.000');
    expect(await fx.writtenFor(proposal.operation_id)).toEqual({ movements: 1, audits: 1, events: 1 });
  });

  it('düzenleme aynı işlemin kalemlerini değiştirir, sürümü artırır; eski sürümün onayı reddedilir, yenisi bir kez uygulanır', async () => {
    const messageId = await userMessage(fx.admin);
    const first = await propose(
      'propose_stock_out',
      { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '2', unit: 'koli' }] },
      { ...admin, messageId },
    );
    const revised = await propose(
      'propose_stock_out',
      { operation_id: first.operation_id, warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '1', unit: 'koli' }] },
      { ...admin, messageId },
    );
    expect(revised).toMatchObject({ operation_id: first.operation_id, version: 2, lines: [{ quantity: '1 koli', base_quantity: '100 metre' }] });
    const items = await fx.db.execute<{ quantity: string; unit: string }>(sql`
      select quantity, unit from operation_items where operation_id = ${first.operation_id}`);
    expect(items).toEqual([{ quantity: '1.000', unit: 'koli' }]);

    // Kullanıcı eski kartı (2 koli) onaylamaya çalışır: reddedilir, stok değişmez.
    const stale = await fx.confirm(card(first.operation_id, 1)).expect(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe('OPERATION_VERSION_MISMATCH');
    expect((await fx.stockOf(fx.main, cable))?.quantity).toBe('950.000');

    await fx.confirm(card(first.operation_id, 2)).expect(200);
    expect((await fx.stockOf(fx.main, cable))?.quantity).toBe('850.000');
    const [audit] = await fx.db.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_logs where entity_id = ${first.operation_id} and action = 'operation.revised'`);
    expect(audit?.count).toBe(1);
  });

  it('düzenlenemeyenler: başkasının önerisi, onaylanmış öneri, başka tür, ekrandan açılmış işlem', async () => {
    const adminProposal = await propose(
      'propose_stock_out',
      { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '5' }] },
      { ...admin, messageId: await userMessage(fx.admin) },
    );
    const revise = (operationId: string, context: ToolContext, name = 'propose_stock_out'): ReturnType<ToolRegistry['execute']> =>
      tools.execute(name, { operation_id: operationId, warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '6' }] }, context);

    expect(await revise(adminProposal.operation_id, { ...employee, messageId: await userMessage(employeeId) })).toEqual({
      isError: true,
      content: 'Yalnızca sohbette kendi açtığın öneri düzenlenebilir.',
    });
    expect((await revise(adminProposal.operation_id, admin, 'propose_waste')).content).toMatch(/türü değiştirilemez/);

    await fx.confirm(card(adminProposal.operation_id, 1)).expect(200);
    expect((await revise(adminProposal.operation_id, admin)).content).toBe('Bu işlem onay beklemiyor; düzenlenemez.');

    const screen = await fx.open('STOCK_OUT', [{ productId: cable, warehouseId: fx.main, quantity: '5' }]);
    expect((await revise(screen.id, admin)).content).toBe('Yalnızca sohbette kendi açtığın öneri düzenlenebilir.');
    expect(await operationRow(screen.id)).toMatchObject({ version: 1, source: 'SCREEN', sourceMessageId: null });
  });

  it('çalışan yetkisi olmayan depoda öneri açamaz; başka şirketin ürünü ve bulunamayan birim kalem hatası olarak döner', async () => {
    const before = await counts();
    expect(
      await tools.execute(
        'propose_transfer',
        { source_warehouse_id: fx.main, target_warehouse_id: fx.branch, lines: [{ product_id: cable, quantity: '10' }] },
        { ...employee, messageId: await userMessage(employeeId) },
      ),
    ).toEqual({ isError: true, content: 'Bu depoda işlem yetkiniz yok.' });

    expect(
      await tools.execute('propose_stock_out', { warehouse_id: fx.main, lines: [{ product_id: otherProduct, quantity: '1' }] }, admin),
    ).toEqual({ isError: true, content: 'İşlemin bazı kalemleri geçersiz. Kalem 1: Ürün bulunamadı.' });

    expect(
      await tools.execute('propose_stock_out', { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '1', unit: 'makara' }] }, admin),
    ).toEqual({
      isError: true,
      content: 'İşlemin bazı kalemleri geçersiz. Kalem 1: Ürünün bu birimi yok. Ürünün birimleri: metre (ana birim), koli (1 koli = 100 metre).',
    });
    expect(await counts()).toEqual(before);
  });

  it('çalışan kendi deposunda öneri açar; stok yetmeyen kalem önizlemede işaretlenir ama stok değişmez', async () => {
    const before = await fx.stockOf(fx.main, cable);
    const proposal = await propose(
      'propose_waste',
      { warehouse_id: fx.main, note: 'kırık geldi', lines: [{ product_id: cable, quantity: '999999' }] },
      { ...employee, messageId: await userMessage(employeeId) },
    );
    expect(proposal).toMatchObject({
      type: 'Fire',
      insufficient_stock: true,
      lines: [{ sufficient: false, available: '845 metre', required: '999.999 metre' }],
    });
    // Stok eksiye düşmez; modele eksi bir "sonra" değeri de verilmez (#74 denemesi).
    expect(proposal.lines[0]).not.toHaveProperty('stock_change');
    expect(JSON.stringify(proposal)).not.toMatch(/[−-]\d[\d.,]*\s(metre|adet|koli)/);
    expect(await fx.stockOf(fx.main, cable)).toEqual(before);
  });

  it('search_parties: Türkçe harf farkı gözetmez, türle süzer, başka şirketin carisini göstermez', async () => {
    const found = await tools.execute('search_parties', { query: 'yildiz yapi' }, admin);
    expect(JSON.parse(found.content)).toEqual({ candidates: [{ party_id: customer, name: 'Yıldız Yapı İnşaat', type: 'Müşteri' }] });
    const suppliers = await tools.execute('search_parties', { query: 'yıldız', type: 'SUPPLIER' }, admin);
    expect(JSON.parse(suppliers.content)).toEqual({ candidates: [] });
    const fromOther = await tools.execute('search_parties', { query: 'yıldız' }, {
      organization: { id: other.org, role: 'ADMIN', membershipId: randomUUID() },
      userId: other.admin,
    });
    expect(JSON.parse(fromOther.content)).toEqual({ candidates: [] });
  });

  it('source_message_id: mesaj silinince işlem kalır, bağ boşalır; yalnızca sohbet işleminde ve aynı şirketin mesajıyla', async () => {
    const messageId = await userMessage(fx.admin);
    const proposal = await propose(
      'propose_count',
      { warehouse_id: fx.main, lines: [{ product_id: cable, counted_quantity: '7', unit: 'koli' }] },
      { ...admin, messageId },
    );

    // Başka şirketin mesajına bağlanamaz (bileşik yabancı anahtar).
    expect(
      await violation(fx.db.execute(sql`update operations set source_message_id = ${otherMessage} where id = ${proposal.operation_id}`)),
    ).toEqual({ code: '23503', constraint: 'operations_source_message_fk' });
    // Ekrandan açılan işlem bir mesaja bağlanamaz (CHECK).
    const screen = await fx.open('STOCK_IN', [{ productId: cable, warehouseId: fx.main, quantity: '1' }]);
    expect(await violation(fx.db.execute(sql`update operations set source_message_id = ${messageId} where id = ${screen.id}`))).toEqual({
      code: '23514',
      constraint: 'operations_source_message_chat',
    });

    // Mesaj (sohbetiyle) silinince işlem ve şirketi kalır, yalnızca bağ boşalır.
    await fx.db.execute(sql`delete from conversations where id = (select conversation_id from messages where id = ${messageId})`);
    expect(await operationRow(proposal.operation_id)).toEqual({
      status: 'PENDING_CONFIRMATION',
      source: 'CHAT',
      version: 1,
      sourceMessageId: null,
    });
  });
});
