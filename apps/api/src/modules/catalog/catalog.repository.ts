import { parties, productUnits, products } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** Çevrilecek kalem: girilen birimde miktar ve isteğe bağlı birim maliyet (metin, ADR-003). */
export interface UnitConversionInput {
  lineNo: number;
  productId: string;
  quantity: string;
  /** Girilen birim; boşsa ürünün ana birimi. */
  unit: string | null;
  unitCost: string | null;
}

// interface değil type: Drizzle'ın execute<T>() satır tipi indeks imzası ister.
export type UnitConversion = {
  lineNo: number;
  productFound: boolean;
  productActive: boolean;
  /** Ürünün kodu ve adı (onay ekranı için); ürün bulunamadıysa null. */
  sku: string | null;
  productName: string | null;
  baseUnit: string | null;
  /** Birim bulunamadıysa false; ana birim adı verildiyse true. */
  unitFound: boolean;
  /** Ana birime çevrim katsayısı; ana birimde girildiyse 1. */
  unitFactor: string;
  /** Ana birimde miktar: round(miktar × katsayı, 3). */
  baseQuantity: string;
  /** Ana birim başına maliyet: round(maliyet ÷ katsayı, 4). Maliyet girilmediyse null. */
  baseUnitCost: string | null;
};

/** Stok ekranlarının ihtiyaç duyduğu ürün bilgisi. */
export type ProductSummary = { id: string; baseUnit: string; minStock: string | null };

/**
 * Diğer modüllerin ihtiyaç duyduğu ürün, birim ve cari sorguları: stok işleminin birim çevrimi ve doğrulaması,
 * onay ekranı için ürün ve cari adları. Ürün ve cari yönetimi ProductsRepository ve PartiesRepository'dedir.
 */
@Injectable()
export class CatalogRepository {
  /**
   * Kalemleri ana birime çevirir. Çarpma, bölme ve yuvarlama SQL'de NUMERIC ile yapılır (ADR-003); sonuçlar
   * metin döner ve uygulamada sayıya çevrilmez. Tek sorguda bütün kalemler: kalem sayısı kadar gidiş-dönüş yok.
   */
  async convertToBaseUnits(
    executor: DbExecutor,
    organizationId: string,
    lines: UnitConversionInput[],
  ): Promise<UnitConversion[]> {
    const values = sql.join(
      lines.map(
        (line) =>
          sql`(${line.lineNo}::int, ${line.productId}::uuid, ${line.quantity}::numeric, ${line.unit}::text, ${line.unitCost}::numeric)`,
      ),
      sql`, `,
    );
    return executor.execute<UnitConversion>(sql`
      select l.line_no as "lineNo",
             p.id is not null as "productFound",
             coalesce(p.is_active, false) as "productActive",
             p.sku as "sku",
             p.name as "productName",
             p.base_unit as "baseUnit",
             (l.unit is null or l.unit = p.base_unit or u.unit is not null) as "unitFound",
             coalesce(u.factor, 1) as "unitFactor",
             round(l.quantity * coalesce(u.factor, 1), 3) as "baseQuantity",
             round(l.unit_cost / coalesce(u.factor, 1), 4) as "baseUnitCost"
      from (values ${values}) as l(line_no, product_id, quantity, unit, unit_cost)
      left join ${products} p on p.organization_id = ${organizationId} and p.id = l.product_id
      left join ${productUnits} u
        on u.organization_id = ${organizationId} and u.product_id = l.product_id and u.unit = l.unit
      order by l.line_no`);
  }

  /** Ürünün ana birimi ve kritik stok eşiği; ürün bu şirkette yoksa null. */
  async findProductSummary(executor: DbExecutor, organizationId: string, productId: string): Promise<ProductSummary | null> {
    const [row] = await executor
      .select({ id: products.id, baseUnit: products.baseUnit, minStock: products.minStock })
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)))
      .limit(1);
    return row ?? null;
  }

  async findPartyName(executor: DbExecutor, organizationId: string, partyId: string): Promise<string | null> {
    const [row] = await executor
      .select({ name: parties.name })
      .from(parties)
      .where(and(eq(parties.organizationId, organizationId), eq(parties.id, partyId)))
      .limit(1);
    return row?.name ?? null;
  }

  /**
   * Verilen SKU ve barkodlardan bu şirkette kullanılanlar (ürün ve ek birim barkodları). İçe aktarmada satır
   * numarasıyla hata vermek için önceden bakılır; aradaki yarışı yine benzersizlik kısıtı kapatır.
   */
  async findTakenCodes(
    executor: DbExecutor,
    organizationId: string,
    codes: { skus: string[]; barcodes: string[] },
  ): Promise<{ skus: Set<string>; barcodes: Set<string> }> {
    const [skuRows, productBarcodeRows, unitBarcodeRows] = await Promise.all([
      codes.skus.length > 0
        ? executor
            .select({ value: products.sku })
            .from(products)
            .where(and(eq(products.organizationId, organizationId), inArray(products.sku, codes.skus)))
        : Promise.resolve([]),
      codes.barcodes.length > 0
        ? executor
            .select({ value: products.barcode })
            .from(products)
            .where(and(eq(products.organizationId, organizationId), inArray(products.barcode, codes.barcodes)))
        : Promise.resolve([]),
      codes.barcodes.length > 0
        ? executor
            .select({ value: productUnits.barcode })
            .from(productUnits)
            .where(and(eq(productUnits.organizationId, organizationId), inArray(productUnits.barcode, codes.barcodes)))
        : Promise.resolve([]),
    ]);
    const present = (rows: { value: string | null }[]): string[] => rows.flatMap((row) => (row.value ? [row.value] : []));
    return {
      skus: new Set(present(skuRows)),
      barcodes: new Set([...present(productBarcodeRows), ...present(unitBarcodeRows)]),
    };
  }

  async isActiveParty(executor: DbExecutor, organizationId: string, partyId: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.organizationId, organizationId), eq(parties.id, partyId), eq(parties.isActive, true)))
      .limit(1);
    return row !== undefined;
  }
}
