// Demo verisi testi: seed iki kez çalıştırılınca kayıt çoğalmaz ve yönetici bağlama doğru çalışır.
// Her test kendi transaction'ında çalışır ve sonunda geri alınır; veritabanında iz kalmaz.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { ABC_ELEKTRIK_ID, abcElektrik, demoCompanies } from '../seed/demo-data.ts';
import { seedDemoData } from '../seed/seed-demo-data.ts';
import type { Database } from '../seed/seed-demo-data.ts';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
}

const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
const db = drizzle(client);

afterAll(async () => {
  await client.end();
});

class Rollback extends Error {}

async function inRolledBackTransaction(run: (tx: Database) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await run(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
}

const DEMO_IDS = demoCompanies.map((company) => company.id);

const COUNTED_TABLES = [
  ['organizations', 'id'],
  ['warehouses', 'organization_id'],
  ['products', 'organization_id'],
  ['product_units', 'organization_id'],
  ['product_aliases', 'organization_id'],
  ['parties', 'organization_id'],
  ['organization_users', 'organization_id'],
] as const;

/** Demo şirketlerine ait satır sayıları. */
async function countDemoRows(tx: Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, column] of COUNTED_TABLES) {
    const rows = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} in ${DEMO_IDS}`,
    );
    counts[table] = rows[0]?.n ?? 0;
  }
  return counts;
}

async function createAuthUser(tx: Database): Promise<{ id: string; email: string }> {
  const user = { id: randomUUID(), email: `seed-${randomUUID()}@test.invalid` };
  await tx.execute(sql`insert into auth.users (id, email) values (${user.id}, ${user.email})`);
  return user;
}

describe('Demo verisi (seed)', () => {
  it('ABC Elektrik plana uygun: 15–20 ürün, 2 depo ve 1 araç deposu', () => {
    expect(abcElektrik.products.length).toBeGreaterThanOrEqual(15);
    expect(abcElektrik.products.length).toBeLessThanOrEqual(20);
    expect(abcElektrik.warehouses.filter((warehouse) => warehouse.type === 'WAREHOUSE')).toHaveLength(2);
    expect(abcElektrik.warehouses.filter((warehouse) => warehouse.type === 'VEHICLE')).toHaveLength(1);
  });

  it('iki kez çalıştırılınca kayıt çoğalmaz', async () => {
    await inRolledBackTransaction(async (tx) => {
      await seedDemoData(tx);
      const afterFirst = await countDemoRows(tx);
      await seedDemoData(tx);
      const afterSecond = await countDemoRows(tx);

      expect(afterSecond).toEqual(afterFirst);
      expect(afterFirst['organizations']).toBe(2);
      const skus = await tx.execute<{ sku: string }>(
        sql`select sku from products where organization_id = ${ABC_ELEKTRIK_ID}`,
      );
      expect(skus.map((row) => row.sku)).toEqual(expect.arrayContaining(abcElektrik.products.map((p) => p.sku)));
    });
  });

  it('miktar ve katsayıları ondalık metin olarak saklar', async () => {
    await inRolledBackTransaction(async (tx) => {
      await seedDemoData(tx);
      const [row] = await tx.execute<{ min_stock: string; factor: string }>(sql`
        select p.min_stock, u.factor from products p
        join product_units u on u.organization_id = p.organization_id and u.product_id = p.id
        where p.organization_id = ${ABC_ELEKTRIK_ID} and p.sku = 'KBL-NYM-325'`);
      expect(row).toEqual({ min_stock: '200.000', factor: '100.000000' });
    });
  });

  it('SEED_ADMIN_EMAIL kullanıcısını ABC Elektrik yöneticisi yapar ve tekrarında çoğaltmaz', async () => {
    await inRolledBackTransaction(async (tx) => {
      const user = await createAuthUser(tx);
      // E-posta büyük/küçük harf farkıyla verilse de bulunur.
      const first = await seedDemoData(tx, { adminEmail: user.email.toUpperCase() });
      const second = await seedDemoData(tx, { adminEmail: user.email });

      expect([first.adminLinked, second.adminLinked]).toEqual([true, true]);
      const memberships = await tx.execute<{ organization_id: string; role: string }>(
        sql`select organization_id, role from organization_users where user_id = ${user.id}`,
      );
      expect([...memberships]).toEqual([{ organization_id: ABC_ELEKTRIK_ID, role: 'ADMIN' }]);
    });
  });

  it('kayıtlı olmayan e-postada kimseyi bağlamaz', async () => {
    await inRolledBackTransaction(async (tx) => {
      const result = await seedDemoData(tx, { adminEmail: `yok-${randomUUID()}@test.invalid` });
      expect(result.adminLinked).toBe(false);
    });
  });
});
