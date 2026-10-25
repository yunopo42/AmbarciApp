// İki şirketli izolasyon testi (2. hafta kapısı): bir şirketin kullanıcısı, Supabase Data API üzerinden
// başka şirketin verisini okuyamaz ve hiçbir tabloya yazamaz.
//
// Data API (PostgREST) her isteği "authenticated" ya da "anon" rolüne geçip JWT içeriğini
// request.jwt.claims ayarına yazarak çalıştırır; RLS politikaları auth.uid() ile bu ayarı okur.
// Test aynısını doğrudan SQL ile yapar. Her test kendi transaction'ında veri oluşturur ve sonunda
// geri alır; veritabanında iz kalmaz, gerçek kullanıcı hesabı açılmaz.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';
import type { TransactionSql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

afterAll(async () => {
  await sql.end();
});

// Şirket kimliğini taşıyan tablolar ve kimliğin kolonu.
const TENANT_TABLES = [
  ['organizations', 'id'],
  ['organization_users', 'organization_id'],
  ['warehouses', 'organization_id'],
  ['user_warehouse_access', 'organization_id'],
  ['products', 'organization_id'],
  ['product_units', 'organization_id'],
  ['product_aliases', 'organization_id'],
  ['parties', 'organization_id'],
  ['inventory', 'organization_id'],
  ['operations', 'organization_id'],
  ['operation_items', 'organization_id'],
  ['inventory_movements', 'organization_id'],
  ['stock_counts', 'organization_id'],
] as const;

// Her üyenin okuyamadığı tablolar: davet kodlarını, denetim kaydını ve model çağrılarını yalnızca yönetici, sohbeti
// ve mesajlarını yalnızca sahibi, outbox'ı hiçbir istemci okuyabilir.
const ALL_TABLES = [
  ...TENANT_TABLES.map(([table]) => table),
  'invitations',
  'audit_logs',
  'outbox_events',
  'conversations',
  'messages',
  'ai_runs',
];

interface Fixture {
  orgA: string;
  orgB: string;
  adminA: string;
  employeeA: string;
  inactiveA: string;
  adminB: string;
  outsider: string;
  productA: string;
  productB: string;
  warehouseA: string;
  warehouseB: string;
  /** A şirketinin uygulanmış giriş işlemi (1 kalem, 1 hareket). */
  operationA: string;
  /** A çalışanının sohbeti ve o sohbetin ilk (kullanıcı) mesajı. */
  conversationA: string;
  messageA: string;
}

const PERMISSION_DENIED = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const GENERATED_ALWAYS = '428C9';

class Rollback extends Error {}

/** Verileri oluşturur, testi çalıştırır ve her şeyi geri alır. */
async function withFixture(run: (tx: TransactionSql, fx: Fixture) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await run(tx, await createFixture(tx));
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

/**
 * Sorguyu Data API'nin yapacağı gibi verilen rol ve kullanıcıyla çalıştırır. Savepoint içinde çalıştığı için
 * sorgu hata verirse yalnızca savepoint geri alınır, rol değişikliği de onunla birlikte kalkar.
 */
async function as<T>(
  tx: TransactionSql,
  role: 'authenticated' | 'anon',
  userId: string | null,
  query: (sp: TransactionSql) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await tx.savepoint(async (sp) => {
    const claims = userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role });
    await sp`select set_config('request.jwt.claims', ${claims}, true)`;
    await sp.unsafe(`set local role ${role}`);
    result = await query(sp);
    await sp`reset role`;
  });
  return result as T;
}

const asUser = <T>(tx: TransactionSql, userId: string, query: (sp: TransactionSql) => Promise<T>): Promise<T> =>
  as(tx, 'authenticated', userId, query);

async function createFixture(tx: TransactionSql): Promise<Fixture> {
  const fx: Fixture = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    adminA: randomUUID(),
    employeeA: randomUUID(),
    inactiveA: randomUUID(),
    adminB: randomUUID(),
    outsider: randomUUID(),
    productA: randomUUID(),
    productB: randomUUID(),
    warehouseA: randomUUID(),
    warehouseB: randomUUID(),
    operationA: randomUUID(),
    conversationA: randomUUID(),
    messageA: randomUUID(),
  };
  const { warehouseB } = fx;

  const users = [fx.adminA, fx.employeeA, fx.inactiveA, fx.adminB, fx.outsider].map((id) => ({
    id,
    email: `rls-${id}@test.invalid`,
  }));
  await tx`insert into auth.users ${tx(users, 'id', 'email')}`;

  await tx`insert into organizations (id, name) values (${fx.orgA}, 'Test A Elektrik'), (${fx.orgB}, 'Test B Elektrik')`;
  const memberships = await tx<{ id: string; user_id: string }[]>`
    insert into organization_users (organization_id, user_id, role, is_active) values
      (${fx.orgA}, ${fx.adminA}, 'ADMIN', true),
      (${fx.orgA}, ${fx.employeeA}, 'EMPLOYEE', true),
      (${fx.orgA}, ${fx.inactiveA}, 'EMPLOYEE', false),
      (${fx.orgB}, ${fx.adminB}, 'ADMIN', true)
    returning id, user_id`;
  const membershipOf = (userId: string): string => {
    const membership = memberships.find((row) => row.user_id === userId);
    if (!membership) {
      throw new Error(`Üyelik bulunamadı: ${userId}`);
    }
    return membership.id;
  };

  // İki şirkette aynı depo adı ve aynı ürün kodu: benzersizlik şirket içinde geçerlidir.
  await tx`insert into warehouses (id, organization_id, name) values
    (${fx.warehouseA}, ${fx.orgA}, 'Ana depo'), (${warehouseB}, ${fx.orgB}, 'Ana depo')`;
  await tx`insert into user_warehouse_access (organization_id, organization_user_id, warehouse_id) values
    (${fx.orgA}, ${membershipOf(fx.employeeA)}, ${fx.warehouseA}),
    (${fx.orgB}, ${membershipOf(fx.adminB)}, ${warehouseB})`;
  await tx`insert into products (id, organization_id, sku, name, base_unit) values
    (${fx.productA}, ${fx.orgA}, 'PRZ-3', 'Üçlü grup priz', 'adet'),
    (${fx.productB}, ${fx.orgB}, 'PRZ-3', 'Üçlü grup priz', 'adet')`;
  await tx`insert into product_units (organization_id, product_id, unit, factor) values
    (${fx.orgA}, ${fx.productA}, 'koli', '12'), (${fx.orgB}, ${fx.productB}, 'koli', '12')`;
  await tx`insert into product_aliases (organization_id, product_id, alias) values
    (${fx.orgA}, ${fx.productA}, 'üçlü priz'), (${fx.orgB}, ${fx.productB}, 'üçlü priz')`;
  await tx`insert into parties (organization_id, name, type) values
    (${fx.orgA}, 'A Tedarik', 'SUPPLIER'), (${fx.orgB}, 'B Tedarik', 'SUPPLIER')`;
  await tx`insert into inventory (organization_id, warehouse_id, product_id, quantity) values
    (${fx.orgA}, ${fx.warehouseA}, ${fx.productA}, '10'), (${fx.orgB}, ${warehouseB}, ${fx.productB}, '5')`;
  await tx`insert into invitations (organization_id, code, role, expires_at, created_by) values
    (${fx.orgA}, ${`A-${randomUUID()}`}, 'EMPLOYEE', now() + interval '1 day', ${fx.adminA}),
    (${fx.orgB}, ${`B-${randomUUID()}`}, 'EMPLOYEE', now() + interval '1 day', ${fx.adminB})`;

  await createLedger(tx, {
    org: fx.orgA,
    product: fx.productA,
    warehouse: fx.warehouseA,
    actor: fx.adminA,
    operation: fx.operationA,
  });
  await createLedger(tx, {
    org: fx.orgB,
    product: fx.productB,
    warehouse: warehouseB,
    actor: fx.adminB,
    operation: randomUUID(),
  });

  await createChat(tx, { org: fx.orgA, user: fx.employeeA, conversation: fx.conversationA, message: fx.messageA });
  // Pasife alınan üyenin eski sohbeti: üyelik pasifken kendisi de göremez.
  await createChat(tx, { org: fx.orgA, user: fx.inactiveA });
  await createChat(tx, { org: fx.orgB, user: fx.adminB });

  return fx;
}

interface ChatInput {
  org: string;
  user: string;
  conversation?: string;
  message?: string;
}

/**
 * Bir kullanıcının sohbeti (4. hafta tabloları): kullanıcı mesajı, araç çağıran asistan mesajı, araç sonucu ve son
 * cevap; ayrıca cevabın iki model çağrısının ai_runs kaydı.
 */
async function createChat(tx: TransactionSql, input: ChatInput): Promise<void> {
  const { org, user } = input;
  const conversation = input.conversation ?? randomUUID();
  const message = input.message ?? randomUUID();
  await tx`insert into conversations (id, organization_id, user_id, title)
    values (${conversation}, ${org}, ${user}, 'Merkez depoda priz')`;
  await tx`insert into messages (id, organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
    values (${message}, ${org}, ${conversation}, ${user}, 1, 'USER',
            ${tx.json([{ type: 'text', text: 'Merkez depoda priz kaç tane?' }])}, ${randomUUID()}, 'COMPLETED')`;
  await tx`insert into messages (organization_id, conversation_id, user_id, position, role, content) values
    (${org}, ${conversation}, ${user}, 2, 'ASSISTANT',
     ${tx.json([{ type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'priz' } }])}),
    (${org}, ${conversation}, ${user}, 3, 'TOOL', ${tx.json([{ type: 'tool_result', tool_use_id: 'toolu_1', content: '[]' }])}),
    (${org}, ${conversation}, ${user}, 4, 'ASSISTANT', ${tx.json([{ type: 'text', text: 'Merkez depoda 10 adet var.' }])})`;
  await tx`insert into ai_runs
      (organization_id, user_id, message_id, round_no, model, prompt_version, effort, tool_calls,
       input_tokens, output_tokens, duration_ms, cost_usd)
    values
      (${org}, ${user}, ${message}, 1, 'claude-haiku-5-5', 'sohbet-v1', 'low', '{search_products}', 4000, 120, 1600, '0.00046'),
      (${org}, ${user}, ${message}, 2, 'claude-haiku-5-5', 'sohbet-v1', 'low', '{}', 4300, 80, 1200, '0.00047')`;
}

interface LedgerInput {
  org: string;
  product: string;
  warehouse: string;
  actor: string;
  operation: string;
}

/**
 * Bir şirket için 3. hafta tablolarına örnek kayıt: uygulanmış bir giriş işlemi (kalemi ve hareketiyle),
 * fark çıkmayan bir sayım, denetim kaydı ve outbox olayı. Stok satırı (10 adet) createFixture'da açılır.
 */
async function createLedger(tx: TransactionSql, input: LedgerInput): Promise<void> {
  const { org, product, warehouse, actor, operation } = input;
  const count = randomUUID();
  await tx`insert into operations (id, organization_id, type, status, source, created_by, applied_by, applied_at) values
    (${operation}, ${org}, 'STOCK_IN', 'APPLIED', 'SCREEN', ${actor}, ${actor}, now()),
    (${count}, ${org}, 'COUNT', 'APPLIED', 'SCREEN', ${actor}, ${actor}, now())`;
  await tx`insert into operation_items (organization_id, operation_id, line_no, product_id, warehouse_id, quantity) values
    (${org}, ${operation}, 1, ${product}, ${warehouse}, '10'),
    (${org}, ${count}, 1, ${product}, ${warehouse}, '10')`;
  await tx`insert into inventory_movements
      (organization_id, operation_id, line_no, warehouse_id, product_id, type, quantity_change, unit_factor,
       unit_cost, quantity_after, average_cost_after)
    values (${org}, ${operation}, 1, ${warehouse}, ${product}, 'IN', '10', '1', '0', '10', '0')`;
  await tx`insert into stock_counts (organization_id, operation_id, line_no, warehouse_id, product_id, system_quantity, counted_quantity)
    values (${org}, ${count}, 1, ${warehouse}, ${product}, '10', '10')`;
  await tx`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, source)
    values (${org}, ${actor}, 'operation.applied', 'operation', ${operation}, 'SCREEN')`;
  await tx`insert into outbox_events (organization_id, event_type, payload)
    values (${org}, 'operation.applied', ${tx.json({ operationId: operation })})`;
}

/** Tablodaki görünür satırların şirket kimlikleri (tekilleştirilmiş). */
async function visibleOrganizations(sp: TransactionSql, table: string, column: string): Promise<string[]> {
  const rows = await sp.unsafe<{ org: string }[]>(`select distinct ${column} as org from ${table}`);
  return rows.map((row) => row.org);
}

describe('İki şirket arasında veri izolasyonu (RLS)', () => {
  it.each(TENANT_TABLES)('%s: her şirket yalnızca kendi satırlarını görür', async (table, column) => {
    await withFixture(async (tx, fx) => {
      expect(await asUser(tx, fx.adminA, (sp) => visibleOrganizations(sp, table, column))).toEqual([fx.orgA]);
      expect(await asUser(tx, fx.adminB, (sp) => visibleOrganizations(sp, table, column))).toEqual([fx.orgB]);
    });
  });

  it('başka şirketin ürünü kimliği bilinse bile okunamaz', async () => {
    await withFixture(async (tx, fx) => {
      const rows = await asUser(tx, fx.adminA, (sp) => sp`select id from products where id = ${fx.productB}`);
      expect(rows).toHaveLength(0);
    });
  });

  it.each(['conversations', 'messages'])(
    '%s: yalnızca sahibi görür; aynı şirketin yöneticisi ve pasif üye göremez',
    async (table) => {
      await withFixture(async (tx, fx) => {
        const owners = async (userId: string): Promise<string[]> => {
          const rows = await asUser(tx, userId, (sp) => sp.unsafe<{ owner: string }[]>(`select distinct user_id as owner from ${table}`));
          return rows.map((row) => row.owner);
        };
        expect(await owners(fx.employeeA)).toEqual([fx.employeeA]);
        expect(await owners(fx.adminB)).toEqual([fx.adminB]);
        expect(await owners(fx.adminA)).toEqual([]);
        expect(await owners(fx.inactiveA)).toEqual([]);
        expect(await owners(fx.outsider)).toEqual([]);
      });
    },
  );

  it.each(['invitations', 'audit_logs', 'ai_runs'])('%s: yalnızca o şirketin yöneticisi görür', async (table) => {
    await withFixture(async (tx, fx) => {
      const of = (userId: string): Promise<string[]> =>
        asUser(tx, userId, (sp) => visibleOrganizations(sp, table, 'organization_id'));
      expect(await of(fx.adminA)).toEqual([fx.orgA]);
      expect(await of(fx.adminB)).toEqual([fx.orgB]);
      expect(await of(fx.employeeA)).toEqual([]);
    });
  });

  it('outbox olaylarını oturum açmış hiçbir kullanıcı, yönetici bile okuyamaz', async () => {
    await withFixture(async (tx, fx) => {
      await expect(asUser(tx, fx.adminA, (sp) => sp`select 1 from outbox_events limit 1`)).rejects.toMatchObject({
        code: PERMISSION_DENIED,
      });
    });
  });

  it('pasif üye ve hiçbir şirkete üye olmayan kullanıcı hiçbir şey görmez', async () => {
    await withFixture(async (tx, fx) => {
      for (const userId of [fx.inactiveA, fx.outsider]) {
        for (const [table, column] of TENANT_TABLES) {
          expect(await asUser(tx, userId, (sp) => visibleOrganizations(sp, table, column))).toEqual([]);
        }
      }
    });
  });

  it('oturum açmamış istemci (anon) hiçbir tabloyu okuyamaz', async () => {
    await withFixture(async (tx) => {
      for (const table of ALL_TABLES) {
        await expect(as(tx, 'anon', null, (sp) => sp.unsafe(`select 1 from ${table} limit 1`))).rejects.toMatchObject({
          code: PERMISSION_DENIED,
        });
      }
    });
  });

  it('RLS yardımcı fonksiyonları anon için kapalıdır', async () => {
    await withFixture(async (tx) => {
      await expect(as(tx, 'anon', null, (sp) => sp`select private.user_organization_ids()`)).rejects.toMatchObject({
        code: PERMISSION_DENIED,
      });
    });
  });
});

describe('Data API üzerinden yazma kapalı (veri yalnızca API üzerinden değişir)', () => {
  const writes: [string, (sp: TransactionSql, fx: Fixture) => Promise<unknown>][] = [
    [
      'kendi şirketine ürün ekleme',
      (sp, fx) =>
        sp`insert into products (organization_id, sku, name, base_unit) values (${fx.orgA}, 'YENI-1', 'Yeni ürün', 'adet')`,
    ],
    ['kendi ürününü güncelleme', (sp, fx) => sp`update products set name = 'Değişti' where id = ${fx.productA}`],
    ['stok miktarını değiştirme', (sp, fx) => sp`update inventory set quantity = 999 where organization_id = ${fx.orgA}`],
    ['stok satırı silme', (sp, fx) => sp`delete from inventory where organization_id = ${fx.orgA}`],
    [
      'kendini başka şirkete üye yapma',
      (sp, fx) =>
        sp`insert into organization_users (organization_id, user_id, role) values (${fx.orgB}, ${fx.adminA}, 'ADMIN')`,
    ],
    ['kendi rolünü yükseltme', (sp, fx) => sp`update organization_users set role = 'ADMIN' where user_id = ${fx.employeeA}`],
    // Stok yalnızca onay uç noktasından değişir: istemci işlem durumunu, hareketleri ve denetim kaydını değiştiremez.
    ['işlemin durumunu değiştirme', (sp, fx) => sp`update operations set status = 'CANCELLED' where id = ${fx.operationA}`],
    [
      'stok hareketi ekleme',
      (sp, fx) =>
        sp`insert into inventory_movements
            (organization_id, operation_id, line_no, warehouse_id, product_id, type, quantity_change, unit_factor,
             unit_cost, quantity_after, average_cost_after)
          values (${fx.orgA}, ${fx.operationA}, 1, ${fx.warehouseA}, ${fx.productA}, 'OUT', '-1', '1', '0', '9', '0')`,
    ],
    ['stok hareketini silme', (sp, fx) => sp`delete from inventory_movements where operation_id = ${fx.operationA}`],
    ['denetim kaydını silme', (sp, fx) => sp`delete from audit_logs where organization_id = ${fx.orgA}`],
    // Sohbet geçmişi yalnızca API'den yazılır: istemci modele gidecek geçmişe mesaj ekleyemez, kaydı değiştiremez.
    [
      'kendi sohbetine asistan mesajı ekleme',
      (sp, fx) =>
        sp`insert into messages (organization_id, conversation_id, user_id, position, role, content)
          values (${fx.orgA}, ${fx.conversationA}, ${fx.employeeA}, 5, 'ASSISTANT', ${sp.json([{ type: 'text', text: 'uydurma' }])})`,
    ],
    ['kendi sohbetinin başlığını değiştirme', (sp, fx) => sp`update conversations set title = 'Değişti' where id = ${fx.conversationA}`],
    ['model çağrısı kaydını silme', (sp, fx) => sp`delete from ai_runs where organization_id = ${fx.orgA}`],
  ];

  it.each(writes)('%s reddedilir', async (_name, write) => {
    await withFixture(async (tx, fx) => {
      await expect(asUser(tx, fx.employeeA, (sp) => write(sp, fx))).rejects.toMatchObject({ code: PERMISSION_DENIED });
    });
  });
});

describe('Veritabanı kısıtları (API hatası olsa bile)', () => {
  it('bir şirketin stoğu başka şirketin ürününe bağlanamaz', async () => {
    await withFixture(async (tx, fx) => {
      const insert = tx.savepoint(
        (sp) => sp`insert into inventory (organization_id, warehouse_id, product_id) values (${fx.orgA}, ${fx.warehouseA}, ${fx.productB})`,
      );
      await expect(insert).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });

  it('stok miktarı eksiye düşemez', async () => {
    await withFixture(async (tx, fx) => {
      const update = tx.savepoint((sp) => sp`update inventory set quantity = -1 where product_id = ${fx.productA}`);
      await expect(update).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });
});

describe('Hareket ve işlem kısıtları', () => {
  /** A şirketinin giriş işleminin 1. kalemi için hareket ekler; değerler verilmezse geçerli bir çıkış yazar. */
  const insertMovement = (
    sp: TransactionSql,
    fx: Fixture,
    values: { type?: string; change?: string; product?: string } = {},
  ): Promise<unknown> =>
    sp`insert into inventory_movements
        (organization_id, operation_id, line_no, warehouse_id, product_id, type, quantity_change, unit_factor,
         unit_cost, quantity_after, average_cost_after)
      values (${fx.orgA}, ${fx.operationA}, 1, ${fx.warehouseA}, ${values.product ?? fx.productA},
              ${values.type ?? 'OUT'}, ${values.change ?? '-1'}, '1', '0', '9', '0')`;

  it('hareket türü ile miktarın yönü uyuşmalı (çıkış artı olamaz, giriş eksi olamaz)', async () => {
    await withFixture(async (tx, fx) => {
      // Fixture'daki IN hareketi silinmeden aynı kaleme ikinci hareket yazılamayacağı için önce o kaldırılır.
      await tx`delete from inventory_movements where operation_id = ${fx.operationA}`;
      await expect(tx.savepoint((sp) => insertMovement(sp, fx, { type: 'OUT', change: '5' }))).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(tx.savepoint((sp) => insertMovement(sp, fx, { type: 'IN', change: '-5' }))).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
      await expect(tx.savepoint((sp) => insertMovement(sp, fx, { type: 'IN', change: '0' }))).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      });
    });
  });

  it('aynı kalem aynı depodaki stoğu ikinci kez değiştiremez (çift uygulama)', async () => {
    await withFixture(async (tx, fx) => {
      const second = tx.savepoint((sp) => insertMovement(sp, fx, { type: 'IN', change: '10' }));
      await expect(second).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  it('hareket başka şirketin ürününe bağlanamaz', async () => {
    await withFixture(async (tx, fx) => {
      await tx`delete from inventory_movements where operation_id = ${fx.operationA}`;
      const insert = tx.savepoint((sp) => insertMovement(sp, fx, { product: fx.productB }));
      await expect(insert).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
    });
  });

  it('bir işlem en fazla bir kez geri alınabilir', async () => {
    await withFixture(async (tx, fx) => {
      const reverse = (sp: TransactionSql): Promise<unknown> =>
        sp`insert into operations (organization_id, type, source, reversed_operation_id)
          values (${fx.orgA}, 'REVERSAL', 'SCREEN', ${fx.operationA})`;
      await tx.savepoint(reverse);
      await expect(tx.savepoint(reverse)).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  it('ters kayıt, geri aldığı işlem olmadan açılamaz', async () => {
    await withFixture(async (tx, fx) => {
      const insert = tx.savepoint(
        (sp) => sp`insert into operations (organization_id, type, source) values (${fx.orgA}, 'REVERSAL', 'SCREEN')`,
      );
      await expect(insert).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  it('sayım farkını veritabanı hesaplar ve elle yazılamaz', async () => {
    await withFixture(async (tx, fx) => {
      await tx`update stock_counts set counted_quantity = '7' where organization_id = ${fx.orgA}`;
      const [row] = await tx<{ difference: string }[]>`select difference from stock_counts where organization_id = ${fx.orgA}`;
      expect(row?.difference).toBe('-3.000');
      const write = tx.savepoint((sp) => sp`update stock_counts set difference = '0' where organization_id = ${fx.orgA}`);
      await expect(write).rejects.toMatchObject({ code: GENERATED_ALWAYS });
    });
  });
});

describe('Sohbet ve model çağrısı kısıtları', () => {
  interface MessageValues {
    org?: string;
    user?: string;
    position?: number;
    role?: string;
    content?: postgres.JSONValue;
    clientMessageId?: string | null;
    status?: string | null;
  }

  /** A çalışanının sohbetine mesaj ekler; değerler verilmezse 5. sıraya geçerli bir kullanıcı mesajı yazar. */
  const insertMessage = (sp: TransactionSql, fx: Fixture, values: MessageValues = {}): Promise<unknown> =>
    sp`insert into messages (organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
      values (${values.org ?? fx.orgA}, ${fx.conversationA}, ${values.user ?? fx.employeeA}, ${values.position ?? 5},
              ${values.role ?? 'USER'}, ${sp.json(values.content ?? [{ type: 'text', text: 'Ostim depoda?' }])},
              ${values.clientMessageId === undefined ? randomUUID() : values.clientMessageId},
              ${values.status === undefined ? 'IN_PROGRESS' : values.status})`;

  it('aynı client_message_id aynı sohbette ikinci kez yazılamaz (mesaj iki kez işlenmez)', async () => {
    await withFixture(async (tx, fx) => {
      const clientMessageId = randomUUID();
      await tx.savepoint((sp) => insertMessage(sp, fx, { clientMessageId }));
      const again = tx.savepoint((sp) => insertMessage(sp, fx, { clientMessageId, position: 6 }));
      await expect(again).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  it('aynı sıraya ikinci mesaj yazılamaz (aynı sohbette iki cevap aynı anda üretilemez)', async () => {
    await withFixture(async (tx, fx) => {
      const insert = tx.savepoint((sp) => insertMessage(sp, fx, { position: 4 }));
      await expect(insert).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });
  });

  it('mesaj, sohbetin sahibi olmayan kullanıcıya ya da başka şirkete bağlanamaz', async () => {
    await withFixture(async (tx, fx) => {
      // RLS mesajdaki kullanıcı kolonuna baktığı için bu kolon sohbetin sahibinden farklı olamamalı.
      await expect(tx.savepoint((sp) => insertMessage(sp, fx, { user: fx.adminA }))).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
      await expect(tx.savepoint((sp) => insertMessage(sp, fx, { org: fx.orgB }))).rejects.toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
      });
    });
  });

  it('istemci kimliği ve durum yalnızca kullanıcı mesajında bulunur; içerik boş olamaz', async () => {
    await withFixture(async (tx, fx) => {
      const invalid: MessageValues[] = [
        { role: 'ASSISTANT', status: null },
        { role: 'ASSISTANT', clientMessageId: null },
        { clientMessageId: null },
        { status: null },
        { content: [] },
        { content: { type: 'text', text: 'dizi değil' } },
      ];
      for (const values of invalid) {
        await expect(tx.savepoint((sp) => insertMessage(sp, fx, values)), JSON.stringify(values)).rejects.toMatchObject({
          code: CHECK_VIOLATION,
        });
      }
      await tx.savepoint((sp) => insertMessage(sp, fx, { role: 'ASSISTANT', clientMessageId: null, status: null }));
    });
  });

  it('hesap silinince sohbet ve mesajları silinir; model çağrısı kaydı şirkette kalır, bağlantıları boşalır', async () => {
    await withFixture(async (tx, fx) => {
      await tx`delete from auth.users where id = ${fx.employeeA}`;
      const [left] = await tx<{ conversations: number; messages: number }[]>`
        select (select count(*)::int from conversations where id = ${fx.conversationA}) as conversations,
               (select count(*)::int from messages where conversation_id = ${fx.conversationA}) as messages`;
      expect(left).toEqual({ conversations: 0, messages: 0 });
      const runs = await tx<{ user_id: string | null; message_id: string | null }[]>`
        select user_id, message_id from ai_runs where organization_id = ${fx.orgA} and user_id is distinct from ${fx.inactiveA}`;
      expect(runs).toEqual([
        { user_id: null, message_id: null },
        { user_id: null, message_id: null },
      ]);
    });
  });
});
