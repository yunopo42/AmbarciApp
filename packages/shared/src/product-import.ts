import { z } from 'zod';

import { productInputSchema } from './catalog.js';
import { isZeroQuantity, quantitySchema, unitCostSchema } from './operations.js';

// Excel/CSV ile ürün içe aktarma (ADR-004). Dosya tarayıcıda okunur; API'ye satırlar JSON olarak gelir ve burada,
// tek tek eklemedekiyle aynı ürün şemasıyla doğrulanır.

export const PRODUCT_IMPORT_MAX_ROWS = 1000;

/** Bir açılış işlemindeki en fazla kalem (işlem şemasının sınırı); daha çok satır birden fazla işleme bölünür. */
export const OPENING_OPERATION_MAX_LINES = 100;

export const productImportRowSchema = z
  .object({
    /** Dosyadaki satır numarası (başlık 1. satır); hatalar bu numarayla bildirilir. */
    row: z.number().int().min(1),
    product: productInputSchema,
    /** Başlangıç stoku, ana birimde. Verilirse seçilen depo için onay bekleyen bir açılış işlemi açılır; 0 yok sayılır. */
    openingQuantity: quantitySchema.optional(),
    /** Başlangıç stokunun ana birim başına maliyeti. */
    openingUnitCost: unitCostSchema.optional(),
  })
  .superRefine((row, context) => {
    if (row.openingUnitCost !== undefined && row.openingQuantity === undefined) {
      context.addIssue({ code: 'custom', path: ['openingUnitCost'], message: 'Birim maliyet yalnızca başlangıç stokuyla girilir.' });
    }
  });
export type ProductImportRow = z.infer<typeof productImportRowSchema>;

/** Satırın stoğa girecek başlangıç miktarı var mı (boş ve 0 yok sayılır). */
export function hasOpeningStock(row: Pick<ProductImportRow, 'openingQuantity'>): boolean {
  return row.openingQuantity !== undefined && !isZeroQuantity(row.openingQuantity);
}

export interface ImportDuplicate {
  /** rows dizisindeki sıra (0'dan). */
  index: number;
  path: (string | number)[];
  message: string;
}

/**
 * Dosya içinde tekrarlanan SKU ve barkodlar. Ürün ve ek birim barkodları birlikte denetlenir: okutulan bir barkod tek
 * bir ürünü göstermeli. Web önizlemesi ve API aynı kuralı bu fonksiyonla uygular.
 */
export function findImportDuplicates(
  rows: { row: number; product: { sku: string; barcode?: string | null | undefined; units: { barcode?: string | null | undefined }[] } }[],
): ImportDuplicate[] {
  const duplicates: ImportDuplicate[] = [];
  const skus = new Map<string, number>();
  const barcodes = new Map<string, number>();
  rows.forEach((row, index) => {
    const sku = row.product.sku.trim();
    const firstSku = skus.get(sku);
    if (firstSku !== undefined) {
      duplicates.push({ index, path: ['product', 'sku'], message: `Bu SKU dosyada ${firstSku}. satırda da var.` });
    } else {
      skus.set(sku, row.row);
    }
    const codes: [string | null | undefined, (string | number)[]][] = [
      [row.product.barcode, ['product', 'barcode']],
      ...row.product.units.map((unit, unitIndex): [string | null | undefined, (string | number)[]] => [
        unit.barcode,
        ['product', 'units', unitIndex, 'barcode'],
      ]),
    ];
    for (const [value, path] of codes) {
      const code = value?.trim();
      if (!code) {
        continue;
      }
      const first = barcodes.get(code);
      if (first !== undefined) {
        duplicates.push({ index, path, message: `Bu barkod dosyada ${first}. satırda da var.` });
      } else {
        barcodes.set(code, row.row);
      }
    }
  });
  return duplicates;
}

/** POST /v1/products/import (yalnızca yönetici): ya bütün satırlar kaydedilir ya hiçbiri. */
export const productImportSchema = z
  .object({
    /** Başlangıç stokunun gireceği depo; dosyada başlangıç stoku varsa zorunlu. */
    warehouseId: z.uuid().optional(),
    rows: z.array(productImportRowSchema).min(1).max(PRODUCT_IMPORT_MAX_ROWS),
  })
  .superRefine((input, context) => {
    if (!input.warehouseId && input.rows.some(hasOpeningStock)) {
      context.addIssue({ code: 'custom', path: ['warehouseId'], message: 'Başlangıç stoku için depo seçilmeli.' });
    }
    for (const duplicate of findImportDuplicates(input.rows)) {
      context.addIssue({ code: 'custom', path: ['rows', duplicate.index, ...duplicate.path], message: duplicate.message });
    }
  });
export type ProductImportInput = z.infer<typeof productImportSchema>;

/** Satır numarasıyla bildirilen hata (422 IMPORT_ROWS_INVALID cevabının details listesi). */
export const productImportRowErrorSchema = z.object({
  row: z.number().int(),
  /** Alan yolu, ör. "product.sku". */
  field: z.string(),
  message: z.string(),
});
export type ProductImportRowError = z.infer<typeof productImportRowErrorSchema>;

export const productImportResultSchema = z.object({
  created: z.number().int(),
  /** Başlangıç stoku için açılan, onay bekleyen açılış işlemleri (100 kalemde bir yenisi). Stok onaylanınca değişir. */
  openingOperationIds: z.array(z.uuid()),
});
export type ProductImportResult = z.infer<typeof productImportResultSchema>;
