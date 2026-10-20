import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import { authUsers } from 'drizzle-orm/supabase';

import {
  organizations,
  organizationUsers,
  parties,
  productAliases,
  products,
  productUnits,
  warehouses,
} from '../schema/index.ts';
import { ABC_ELEKTRIK_ID, demoCompanies } from './demo-data.ts';
import type { DemoCompany } from './demo-data.ts';

/** Bağlantı nesnesi ya da transaction; seed ikisinde de çalışır. */
export type Database = PgDatabase<PostgresJsQueryResultHKT>;

export interface SeedOptions {
  /** Bu e-postayla Supabase Auth'ta kayıtlı kullanıcı ABC Elektrik'e yönetici (ADMIN) olarak bağlanır. */
  adminEmail?: string;
}

export interface SeedResult {
  companies: number;
  warehouses: number;
  products: number;
  parties: number;
  /** adminEmail verilmediyse null; verildiyse kullanıcı bulunup bağlandı mı. */
  adminLinked: boolean | null;
}

/**
 * Demo verisini yükler. Her kayıt kendi doğal anahtarıyla eklenir ya da güncellenir
 * (şirket: sabit kimlik, depo: ad, ürün: SKU, birim: ürün + birim, cari: VKN); tekrar çalıştırmak kayıt çoğaltmaz.
 * Veritabanına postgres kullanıcısıyla bağlanılır; RLS seed'i etkilemez.
 */
export async function seedDemoData(db: Database, options: SeedOptions = {}): Promise<SeedResult> {
  const result: SeedResult = { companies: 0, warehouses: 0, products: 0, parties: 0, adminLinked: null };
  for (const company of demoCompanies) {
    await seedCompany(db, company);
    result.companies += 1;
    result.warehouses += company.warehouses.length;
    result.products += company.products.length;
    result.parties += company.parties.length;
  }
  if (options.adminEmail) {
    result.adminLinked = await linkAdmin(db, options.adminEmail);
  }
  return result;
}

async function seedCompany(db: Database, company: DemoCompany): Promise<void> {
  const organizationId = company.id;

  await db
    .insert(organizations)
    .values({ id: organizationId, name: company.name })
    .onConflictDoUpdate({ target: organizations.id, set: { name: company.name, updatedAt: sql`now()` } });

  await db
    .insert(warehouses)
    .values(company.warehouses.map((warehouse) => ({ organizationId, name: warehouse.name, type: warehouse.type })))
    .onConflictDoUpdate({
      target: [warehouses.organizationId, warehouses.name],
      set: { type: sql`excluded.type`, isActive: true, updatedAt: sql`now()` },
    });

  // returning hem yeni eklenen hem güncellenen satırları döner; birim ve adlar ürün kimliğine bağlanır.
  const productRows = await db
    .insert(products)
    .values(
      company.products.map((product) => ({
        organizationId,
        sku: product.sku,
        name: product.name,
        baseUnit: product.baseUnit,
        barcode: product.barcode,
        minStock: product.minStock,
      })),
    )
    .onConflictDoUpdate({
      target: [products.organizationId, products.sku],
      set: {
        name: sql`excluded.name`,
        baseUnit: sql`excluded.base_unit`,
        barcode: sql`excluded.barcode`,
        minStock: sql`excluded.min_stock`,
        isActive: true,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: products.id, sku: products.sku });

  const productIds = new Map(productRows.map((row) => [row.sku, row.id]));
  const productIdOf = (sku: string): string => {
    const id = productIds.get(sku);
    if (!id) {
      throw new Error(`Ürün kimliği bulunamadı: ${sku}`);
    }
    return id;
  };

  await db
    .insert(productUnits)
    .values(
      company.products.map((product) => ({
        organizationId,
        productId: productIdOf(product.sku),
        unit: product.unit.name,
        factor: product.unit.factor,
      })),
    )
    .onConflictDoUpdate({
      target: [productUnits.organizationId, productUnits.productId, productUnits.unit],
      set: { factor: sql`excluded.factor`, updatedAt: sql`now()` },
    });

  await db
    .insert(productAliases)
    .values(
      company.products.flatMap((product) =>
        product.aliases.map((alias) => ({ organizationId, productId: productIdOf(product.sku), alias })),
      ),
    )
    .onConflictDoNothing({ target: [productAliases.organizationId, productAliases.productId, productAliases.alias] });

  await db
    .insert(parties)
    .values(company.parties.map((party) => ({ organizationId, name: party.name, type: party.type, taxId: party.taxId })))
    .onConflictDoUpdate({
      target: [parties.organizationId, parties.taxId],
      set: { name: sql`excluded.name`, type: sql`excluded.type`, isActive: true, updatedAt: sql`now()` },
    });
}

/** Kullanıcı hesabı açmaz; yalnızca var olan kullanıcıyı bulup ABC Elektrik'e yönetici olarak bağlar. */
async function linkAdmin(db: Database, email: string): Promise<boolean> {
  const [user] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(sql`lower(${authUsers.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!user) {
    return false;
  }
  await db
    .insert(organizationUsers)
    .values({ organizationId: ABC_ELEKTRIK_ID, userId: user.id, role: 'ADMIN' })
    .onConflictDoUpdate({
      target: [organizationUsers.organizationId, organizationUsers.userId],
      set: { role: 'ADMIN', isActive: true, updatedAt: sql`now()` },
    });
  return true;
}
