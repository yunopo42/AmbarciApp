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
] as const;

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
}

const PERMISSION_DENIED = '42501';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

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
  };
  const warehouseB = randomUUID();

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

  return fx;
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

  it('davet kodlarını yalnızca o şirketin yöneticisi görür', async () => {
    await withFixture(async (tx, fx) => {
      const of = (userId: string): Promise<string[]> =>
        asUser(tx, userId, (sp) => visibleOrganizations(sp, 'invitations', 'organization_id'));
      expect(await of(fx.adminA)).toEqual([fx.orgA]);
      expect(await of(fx.adminB)).toEqual([fx.orgB]);
      expect(await of(fx.employeeA)).toEqual([]);
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
      for (const [table] of TENANT_TABLES) {
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
