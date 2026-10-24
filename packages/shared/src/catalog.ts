import { z } from 'zod';

import { isZeroQuantity, quantitySchema } from './operations.js';

// Katalog: ürün (stok kartı), ek birimleri, sahadaki adları ve cariler. Sayısal alanlar metin olarak taşınır ve
// sayıya çevrilmez (ADR-003); hane sınırları veritabanı kolonlarıyla aynıdır.

/** Barkod: harf, rakam, tire ve nokta (EAN-13, iç kodlar). Biçim kontrolü okutma sırasında yapılır (7. hafta). */
export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z.-]{4,64}$/, 'Barkod 4–64 karakterlik harf, rakam, tire ya da nokta olmalı.');

/** Çevrim katsayısı, NUMERIC(14,6): en fazla 8 tam ve 6 ondalık hane, sıfırdan büyük (1 koli = "12"). */
export const unitFactorSchema = z
  .string()
  .regex(/^\d{1,8}(\.\d{1,6})?$/, 'Katsayı en fazla 6 ondalık haneli bir sayı olmalı (ör. 12 ya da 0.5).')
  .refine((value) => !isZeroQuantity(value), 'Katsayı sıfırdan büyük olmalı.');

export const productUnitInputSchema = z.object({
  /** Birimin adı (koli, makara). Ana birim burada yazılmaz. */
  unit: z.string().trim().min(1).max(40),
  /** Bu birimin kaç ana birim ettiği. */
  factor: unitFactorSchema,
  barcode: barcodeSchema.nullable().optional(),
});
export type ProductUnitInput = z.infer<typeof productUnitInputSchema>;

/** Türkçe büyük/küçük harf farkı gözetmeden karşılaştırma anahtarı ("Koli" ile "koli", "İ" ile "i" aynı). */
function sameText(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR');
}

/**
 * POST /v1/products ve PUT /v1/products/{id}: ürünün tamamı. PUT'ta birim ve alternatif ad listeleri de tamamen
 * değiştirilir: listede olmayan birim ve ad silinir.
 */
export const productInputSchema = z
  .object({
    sku: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(200),
    /** Stokun tutulduğu birim (adet, metre, kg). Hareketi olan ürünün ana birimi değiştirilemez. */
    baseUnit: z.string().trim().min(1).max(40),
    barcode: barcodeSchema.nullable().optional(),
    /** Kritik stok eşiği (ana birimde); boşsa kritik stok uyarısı yapılmaz. */
    minStock: quantitySchema.nullable().optional(),
    units: z.array(productUnitInputSchema).max(10).default([]),
    /** Sahada kullanılan diğer adlar ("üçlü priz"); asistan ürünü bu adlarla da bulur. */
    aliases: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    isActive: z.boolean().default(true),
  })
  .superRefine((product, context) => {
    const units = new Set<string>();
    product.units.forEach((unit, index) => {
      const key = sameText(unit.unit);
      if (key === sameText(product.baseUnit)) {
        context.addIssue({ code: 'custom', path: ['units', index, 'unit'], message: 'Ana birim ek birim olarak yazılmaz.' });
      } else if (units.has(key)) {
        context.addIssue({ code: 'custom', path: ['units', index, 'unit'], message: 'Bu birim zaten listede.' });
      }
      units.add(key);
    });
    const aliases = new Set<string>();
    product.aliases.forEach((alias, index) => {
      const key = sameText(alias);
      if (aliases.has(key)) {
        context.addIssue({ code: 'custom', path: ['aliases', index], message: 'Bu ad zaten listede.' });
      }
      aliases.add(key);
    });
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const productUnitSchema = z.object({
  unit: z.string(),
  factor: z.string(),
  barcode: z.string().nullable(),
});
export type ProductUnit = z.infer<typeof productUnitSchema>;

export const productSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  baseUnit: z.string(),
  barcode: z.string().nullable(),
  minStock: z.string().nullable(),
  isActive: z.boolean(),
  units: z.array(productUnitSchema),
  aliases: z.array(z.string()),
});
export type Product = z.infer<typeof productSchema>;

/** Listelerde durum süzgeci: varsayılan yalnızca aktif kayıtlar. */
export const recordStatusFilterSchema = z.enum(['active', 'inactive', 'all']);
export type RecordStatusFilter = z.infer<typeof recordStatusFilterSchema>;

/** Sayfalama: sorgu parametreleri metin gelir, sayıya çevrilir (bunlar miktar değil, sayfa numarası). */
const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

/** GET /v1/products: ad, SKU, barkod ya da alternatif adda arama. */
export const productListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: recordStatusFilterSchema.default('active'),
  ...pageQuery,
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productListSchema = z.object({
  items: z.array(productSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProductList = z.infer<typeof productListSchema>;

export const partyTypeSchema = z.enum(['SUPPLIER', 'CUSTOMER']);
export type PartyType = z.infer<typeof partyTypeSchema>;

/** POST /v1/parties ve PUT /v1/parties/{id}. VKN 10, TCKN 11 hane; TCKN kişisel veridir, loglanmaz. */
export const partyInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: partyTypeSchema,
  taxId: z
    .string()
    .trim()
    .regex(/^\d{10,11}$/, 'VKN 10, TCKN 11 haneli olmalı.')
    .nullable()
    .optional(),
  isActive: z.boolean().default(true),
});
export type PartyInput = z.infer<typeof partyInputSchema>;

export const partySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: partyTypeSchema,
  taxId: z.string().nullable(),
  isActive: z.boolean(),
});
export type Party = z.infer<typeof partySchema>;

export const partyListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  type: partyTypeSchema.optional(),
  status: recordStatusFilterSchema.default('active'),
  ...pageQuery,
});
export type PartyListQuery = z.infer<typeof partyListQuerySchema>;

export const partyListSchema = z.object({
  items: z.array(partySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PartyList = z.infer<typeof partyListSchema>;
