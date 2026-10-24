import { partyInputSchema, productInputSchema, productListQuerySchema } from '@ambarci/shared';
import { describe, expect, it } from 'vitest';

import { foldForSearch } from '../src/common/search.js';

// Katalog şemalarının kuralları (veritabanı gerekmez). Kısıtların veritabanındaki karşılığı (aynı SKU, kullanılmış
// birim) test-db/catalog.db.spec.ts'te sınanır.

const product = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  sku: 'PRZ-1',
  name: 'Topraklı priz',
  baseUnit: 'adet',
  ...overrides,
});

function issues(schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } }, body: unknown): string[] {
  const result = schema.safeParse(body);
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('Ürün şeması', () => {
  it('birim ve ad listeleri verilmezse boş, ürün varsayılan olarak aktif', () => {
    expect(productInputSchema.parse(product())).toMatchObject({ units: [], aliases: [], isActive: true });
  });

  it('katsayı metin, sıfırdan büyük ve en fazla 6 ondalık', () => {
    expect(issues(productInputSchema, product({ units: [{ unit: 'koli', factor: '12' }] }))).toEqual([]);
    expect(issues(productInputSchema, product({ units: [{ unit: 'koli', factor: '0' }] }))).toEqual(['units.0.factor']);
    expect(issues(productInputSchema, product({ units: [{ unit: 'koli', factor: '0.0000001' }] }))).toEqual([
      'units.0.factor',
    ]);
    expect(issues(productInputSchema, product({ units: [{ unit: 'koli', factor: 12 }] }))).toEqual(['units.0.factor']);
  });

  it('ana birim ek birim olarak yazılamaz; aynı birim iki kez yazılamaz (büyük/küçük harf farkı yok)', () => {
    expect(issues(productInputSchema, product({ units: [{ unit: 'Adet', factor: '1' }] }))).toEqual(['units.0.unit']);
    expect(
      issues(productInputSchema, product({ units: [{ unit: 'koli', factor: '12' }, { unit: 'KOLİ', factor: '10' }] })),
    ).toEqual(['units.1.unit']);
  });

  it('alternatif ad iki kez yazılamaz; Türkçe "İ" ile "i" aynı sayılır', () => {
    expect(issues(productInputSchema, product({ aliases: ['üçlü priz', 'ÜÇLÜ PRİZ'] }))).toEqual(['aliases.1']);
  });

  it('kritik stok eşiği miktar biçiminde', () => {
    expect(issues(productInputSchema, product({ minStock: '12.5' }))).toEqual([]);
    expect(issues(productInputSchema, product({ minStock: '12,5' }))).toEqual(['minStock']);
  });

  it('liste sorgusu: sayfa ve boyut metinden sayıya, boyut en fazla 100', () => {
    expect(productListQuerySchema.parse({ page: '2', pageSize: '10' })).toMatchObject({ page: 2, pageSize: 10, status: 'active' });
    expect(issues(productListQuerySchema, { pageSize: '500' })).toEqual(['pageSize']);
  });
});

describe('Türkçe arama biçimi', () => {
  it('I, İ, ı ve i aynı harf sayılır; büyük/küçük harf farkı yok', () => {
    expect(foldForSearch('YANGIN')).toBe(foldForSearch('yangın'));
    expect(foldForSearch('yangin')).toBe(foldForSearch('Yangın'));
    expect(foldForSearch('İSTANBUL')).toBe('istanbul');
    expect(foldForSearch('ÜÇLÜ PRİZ')).toBe('üçlü priz');
  });
});

describe('Cari şeması', () => {
  it('VKN 10, TCKN 11 hane; boş bırakılabilir', () => {
    expect(issues(partyInputSchema, { name: 'A', type: 'SUPPLIER', taxId: '9990000011' })).toEqual([]);
    expect(issues(partyInputSchema, { name: 'A', type: 'SUPPLIER', taxId: '12345678901' })).toEqual([]);
    expect(issues(partyInputSchema, { name: 'A', type: 'SUPPLIER' })).toEqual([]);
    expect(issues(partyInputSchema, { name: 'A', type: 'SUPPLIER', taxId: '123' })).toEqual(['taxId']);
    expect(issues(partyInputSchema, { name: 'A', type: 'BANKA' })).toEqual(['type']);
  });
});
