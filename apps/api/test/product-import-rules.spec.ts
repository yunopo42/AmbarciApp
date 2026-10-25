import { hasOpeningStock, PRODUCT_IMPORT_MAX_ROWS, productImportSchema } from '@ambarci/shared';
import { describe, expect, it } from 'vitest';

// İçe aktarma şemasının kuralları (veritabanı gerekmez). Web önizlemesi aynı şemayı ve aynı tekrar kontrolünü
// kullanır. Şirkette zaten kullanılan kodlar test-db/product-import.db.spec.ts'te sınanır.

const row = (number: number, product: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  row: number,
  product: { sku: `SKU-${number}`, name: `Ürün ${number}`, baseUnit: 'adet', ...product },
  ...extra,
});

function issues(body: unknown): { path: string; message: string }[] {
  const result = productImportSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

describe('Ürün içe aktarma şeması', () => {
  it('geçerli satırlar; ürün kuralları tek tek eklemedekiyle aynı', () => {
    expect(issues({ rows: [row(2), row(3, { units: [{ unit: 'koli', factor: '12' }], aliases: ['priz'] })] })).toEqual([]);
    expect(issues({ rows: [row(2, { units: [{ unit: 'koli', factor: '0' }] })] }).map((issue) => issue.path)).toEqual([
      'rows.0.product.units.0.factor',
    ]);
  });

  it('dosyada tekrarlanan SKU ve barkod, ilk geçtiği satır numarasıyla bildirilir', () => {
    const found = issues({
      rows: [
        row(2, { barcode: '2000000000053' }),
        row(3, { sku: 'SKU-2' }),
        row(4, { units: [{ unit: 'koli', factor: '12', barcode: '2000000000053' }] }),
      ],
    });
    expect(found).toEqual([
      { path: 'rows.1.product.sku', message: 'Bu SKU dosyada 2. satırda da var.' },
      { path: 'rows.2.product.units.0.barcode', message: 'Bu barkod dosyada 2. satırda da var.' },
    ]);
  });

  it(`en fazla ${PRODUCT_IMPORT_MAX_ROWS} satır; boş dosya kabul edilmez`, () => {
    const many = Array.from({ length: PRODUCT_IMPORT_MAX_ROWS + 1 }, (_, index) => row(index + 2));
    expect(issues({ rows: many }).map((issue) => issue.path)).toEqual(['rows']);
    expect(issues({ rows: [] }).map((issue) => issue.path)).toEqual(['rows']);
  });

  it('başlangıç stoku varsa depo zorunlu; 0 başlangıç stoku sayılmaz; maliyet stoksuz girilmez', () => {
    expect(issues({ rows: [row(2, {}, { openingQuantity: '10' })] }).map((issue) => issue.path)).toEqual(['warehouseId']);
    expect(issues({ rows: [row(2, {}, { openingQuantity: '0' })] })).toEqual([]);
    expect(hasOpeningStock({ openingQuantity: '0.000' })).toBe(false);
    expect(issues({ rows: [row(2, {}, { openingUnitCost: '10' })] }).map((issue) => issue.path)).toEqual([
      'rows.0.openingUnitCost',
    ]);
  });
});
