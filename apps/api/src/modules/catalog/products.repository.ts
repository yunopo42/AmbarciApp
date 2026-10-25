import { productAliases, products, productUnits } from '@ambarci/db';
import type { Database, DbExecutor } from '@ambarci/db';
import type { Product, ProductInput, ProductList, ProductListQuery } from '@ambarci/shared';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { containsText } from '../../common/search.js';
import { DATABASE } from '../../database/database.module.js';

const PRODUCT_COLUMNS = {
  id: products.id,
  sku: products.sku,
  name: products.name,
  baseUnit: products.baseUnit,
  barcode: products.barcode,
  minStock: products.minStock,
  isActive: products.isActive,
};

type ProductRow = Omit<Product, 'units' | 'aliases'>;

/**
 * Ürün, birim ve alternatif ad sorguları; her sorgu şirket kimliğiyle sınırlanır. Kısıt ihlalleri (aynı SKU,
 * kullanılan birimin silinmesi) burada yakalanmaz; ProductsService kısıt adına göre anlamlı hataya çevirir.
 */
@Injectable()
export class ProductsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(organizationId: string, query: ProductListQuery): Promise<ProductList> {
    const conditions: SQL[] = [eq(products.organizationId, organizationId)];
    if (query.status !== 'all') {
      conditions.push(eq(products.isActive, query.status === 'active'));
    }
    if (query.search) {
      const search = query.search;
      const byAlias = this.db
        .select({ one: sql`1` })
        .from(productAliases)
        .where(
          and(
            eq(productAliases.organizationId, organizationId),
            eq(productAliases.productId, products.id),
            containsText(productAliases.alias, search),
          ),
        );
      const matches = or(
        containsText(products.name, search),
        containsText(products.sku, search),
        containsText(products.barcode, search),
        sql`exists (${byAlias})`,
      );
      if (matches) {
        conditions.push(matches);
      }
    }
    const where = and(...conditions);

    const [totalRow] = await this.db.select({ total: count() }).from(products).where(where);
    const rows = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(where)
      .orderBy(asc(products.name), asc(products.sku))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      items: await this.withDetails(this.db, organizationId, rows),
      total: totalRow?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** executor verilmezse bağlantı havuzu; ekleme ve güncellemede aynı transaction. */
  async findById(organizationId: string, productId: string, executor: DbExecutor = this.db): Promise<Product | null> {
    const rows = await executor
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
      .limit(1);
    const [product] = await this.withDetails(executor, organizationId, rows);
    return product ?? null;
  }

  /** Ürünü birimleri ve alternatif adlarıyla tek transaction'da ekler. */
  async create(organizationId: string, input: ProductInput): Promise<Product> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({ organizationId, ...productFields(input) })
        .returning({ id: products.id });
      if (!row) {
        throw new Error('Ürün eklenemedi.');
      }
      await replaceUnits(tx, organizationId, row.id, input);
      await replaceAliases(tx, organizationId, row.id, input);
      return requireProduct(await this.findById(organizationId, row.id, tx));
    });
  }

  /**
   * Ürünleri birimleri ve adlarıyla toplu ekler (içe aktarma). executor açık bir transaction'dır; hata olursa hiçbiri
   * kalmaz. Satır satır değil, tablo başına 1.000'erlik toplu INSERT: her sorgu Render'dan ~22 ms sürdüğü için
   * 1.000 ürünü tek tek eklemek ~3.000 sorgu olurdu. Benzersizlik yine veritabanı kısıtlarıyla korunur.
   */
  async insertMany(executor: DbExecutor, organizationId: string, inputs: ProductInput[]): Promise<{ id: string; sku: string }[]> {
    const created: { id: string; sku: string }[] = [];
    for (const batch of chunks(inputs, BATCH_SIZE)) {
      created.push(
        ...(await executor
          .insert(products)
          .values(batch.map((input) => ({ organizationId, ...productFields(input) })))
          .returning({ id: products.id, sku: products.sku })),
      );
    }
    const idOf = new Map(created.map((row) => [row.sku, row.id]));
    const productId = (sku: string): string => {
      const id = idOf.get(sku);
      if (!id) {
        throw new Error(`Eklenen ürün bulunamadı (${sku}).`);
      }
      return id;
    };
    const units = inputs.flatMap((input) =>
      input.units.map((unit) => ({
        organizationId,
        productId: productId(input.sku),
        unit: unit.unit,
        factor: unit.factor,
        barcode: unit.barcode ?? null,
      })),
    );
    for (const batch of chunks(units, BATCH_SIZE)) {
      await executor.insert(productUnits).values(batch);
    }
    const aliases = inputs.flatMap((input) =>
      input.aliases.map((alias) => ({ organizationId, productId: productId(input.sku), alias })),
    );
    for (const batch of chunks(aliases, BATCH_SIZE)) {
      await executor.insert(productAliases).values(batch);
    }
    return created;
  }

  /**
   * Ürünü, birimlerini ve adlarını tek transaction'da günceller; ürün bu şirkette yoksa null döner. Listede olmayan
   * birim ve ad silinir. Geçmiş işlemlerde kullanılmış bir birimin silinmesi (ya da adının değişmesi) yabancı anahtar
   * tarafından reddedilir ve transaction'ın tamamı geri alınır.
   */
  async update(organizationId: string, productId: string, input: ProductInput): Promise<Product | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(products)
        .set(productFields(input))
        .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
        .returning({ id: products.id });
      if (!row) {
        return null;
      }
      await replaceUnits(tx, organizationId, productId, input);
      await replaceAliases(tx, organizationId, productId, input);
      return requireProduct(await this.findById(organizationId, productId, tx));
    });
  }

  /** Ürün satırlarına birimlerini ve adlarını ekler (sayfa başına iki sorgu; ürün başına sorgu yok). */
  private async withDetails(executor: DbExecutor, organizationId: string, rows: ProductRow[]): Promise<Product[]> {
    if (rows.length === 0) {
      return [];
    }
    const ids = rows.map((row) => row.id);
    const [units, aliases] = await Promise.all([
      executor
        .select({ productId: productUnits.productId, unit: productUnits.unit, factor: productUnits.factor, barcode: productUnits.barcode })
        .from(productUnits)
        .where(and(eq(productUnits.organizationId, organizationId), inArray(productUnits.productId, ids)))
        .orderBy(asc(productUnits.unit)),
      executor
        .select({ productId: productAliases.productId, alias: productAliases.alias })
        .from(productAliases)
        .where(and(eq(productAliases.organizationId, organizationId), inArray(productAliases.productId, ids)))
        .orderBy(asc(productAliases.alias)),
    ]);
    return rows.map((row) => ({
      ...row,
      units: units.filter((unit) => unit.productId === row.id).map(({ unit, factor, barcode }) => ({ unit, factor, barcode })),
      aliases: aliases.filter((alias) => alias.productId === row.id).map(({ alias }) => alias),
    }));
  }
}

// Toplu INSERT'te satır sayısı: PostgreSQL bir ifadede en fazla 65.535 parametre alır (1.000 ürün × 7 kolon = 7.000).
const BATCH_SIZE = 1000;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

function productFields(input: ProductInput): {
  sku: string;
  name: string;
  baseUnit: string;
  barcode: string | null;
  minStock: string | null;
  isActive: boolean;
} {
  return {
    sku: input.sku,
    name: input.name,
    baseUnit: input.baseUnit,
    barcode: input.barcode ?? null,
    minStock: input.minStock ?? null,
    isActive: input.isActive,
  };
}

/** Birim listesini verilenle aynı yapar: olanı günceller, yeniyi ekler, listede olmayanı siler. */
async function replaceUnits(executor: DbExecutor, organizationId: string, productId: string, input: ProductInput): Promise<void> {
  const names = input.units.map((unit) => unit.unit);
  const scope = and(eq(productUnits.organizationId, organizationId), eq(productUnits.productId, productId));
  await executor
    .delete(productUnits)
    .where(names.length > 0 ? and(scope, notInArray(productUnits.unit, names)) : scope);
  if (input.units.length > 0) {
    await executor
      .insert(productUnits)
      .values(
        input.units.map((unit) => ({
          organizationId,
          productId,
          unit: unit.unit,
          factor: unit.factor,
          barcode: unit.barcode ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [productUnits.organizationId, productUnits.productId, productUnits.unit],
        set: { factor: sql`excluded.factor`, barcode: sql`excluded.barcode`, updatedAt: sql`now()` },
      });
  }
}

/** Alternatif adları verilenle aynı yapar. */
async function replaceAliases(executor: DbExecutor, organizationId: string, productId: string, input: ProductInput): Promise<void> {
  const scope = and(eq(productAliases.organizationId, organizationId), eq(productAliases.productId, productId));
  await executor
    .delete(productAliases)
    .where(input.aliases.length > 0 ? and(scope, notInArray(productAliases.alias, input.aliases)) : scope);
  if (input.aliases.length > 0) {
    await executor
      .insert(productAliases)
      .values(input.aliases.map((alias) => ({ organizationId, productId, alias })))
      .onConflictDoNothing({ target: [productAliases.organizationId, productAliases.productId, productAliases.alias] });
  }
}

function requireProduct(product: Product | null): Product {
  if (!product) {
    throw new Error('Yazılan ürün okunamadı.');
  }
  return product;
}
