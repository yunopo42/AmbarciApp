import { parties, productUnits, products } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

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

/**
 * Ürün, birim ve cari sorguları. Ürün yönetimi uçları #36'da bu modüle eklenecek; şimdilik stok işleminin
 * ihtiyaç duyduğu çevrim ve doğrulama sorguları var.
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

  async isActiveParty(executor: DbExecutor, organizationId: string, partyId: string): Promise<boolean> {
    const [row] = await executor
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.organizationId, organizationId), eq(parties.id, partyId), eq(parties.isActive, true)))
      .limit(1);
    return row !== undefined;
  }
}
