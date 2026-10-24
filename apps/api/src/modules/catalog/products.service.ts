import type { Product, ProductInput, ProductList, ProductListQuery } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ProductsRepository } from './products.repository.js';

// Veritabanı kısıtı → kullanıcıya gösterilecek hata. Benzersizlik ve yabancı anahtarlar son savunma hattıdır;
// API aynı kuralı önceden ayrıca kontrol etmez, kısıtın adına bakarak anlamlı bir 409 döner.
const CONFLICTS: Record<string, { code: string; message: string }> = {
  products_org_sku_key: { code: 'PRODUCT_SKU_TAKEN', message: 'Bu ürün kodu (SKU) başka bir üründe kullanılıyor.' },
  products_org_barcode_key: { code: 'PRODUCT_BARCODE_TAKEN', message: 'Bu barkod başka bir üründe kullanılıyor.' },
  product_units_org_barcode_key: { code: 'UNIT_BARCODE_TAKEN', message: 'Bu birim barkodu başka bir üründe kullanılıyor.' },
  operation_items_unit_fk: {
    code: 'UNIT_IN_USE',
    message: 'Silinmek ya da adı değiştirilmek istenen birim işlemlerde kullanılmış; yeni bir birim ekleyin.',
  },
};

@Injectable()
export class ProductsService {
  constructor(
    @Inject(ProductsRepository) private readonly repository: ProductsRepository,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  list(organizationId: string, query: ProductListQuery): Promise<ProductList> {
    return this.repository.list(organizationId, query);
  }

  async get(organizationId: string, productId: string): Promise<Product> {
    const product = await this.repository.findById(organizationId, productId);
    if (!product) {
      throw productNotFound();
    }
    return product;
  }

  create(organizationId: string, input: ProductInput): Promise<Product> {
    return withConflicts(() => this.repository.create(organizationId, input));
  }

  /**
   * Ürünü günceller. Ürün silinmez; pasife almak için isActive: false gönderilir. Hareketi olan ürünün ana birimi
   * değiştirilemez: stok ve hareketler o birimde tutulduğu için geçmiş anlamsızlaşırdı.
   */
  async update(organizationId: string, productId: string, input: ProductInput): Promise<Product> {
    const current = await this.get(organizationId, productId);
    if (current.baseUnit !== input.baseUnit && (await this.inventory.productHasMovements(organizationId, productId))) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'BASE_UNIT_LOCKED',
        'Stok hareketi olan ürünün ana birimi değiştirilemez.',
      );
    }
    const updated = await withConflicts(() => this.repository.update(organizationId, productId, input));
    if (!updated) {
      throw productNotFound();
    }
    return updated;
  }
}

async function withConflicts<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const { constraint } = postgresErrorOf(error);
    const conflict = constraint ? CONFLICTS[constraint] : undefined;
    if (conflict) {
      throw new ApiException(HttpStatus.CONFLICT, conflict.code, conflict.message);
    }
    throw error;
  }
}

function productNotFound(): ApiException {
  // Başka şirketin ürünü de aynı cevabı alır: varlığı sızmaz.
  return new ApiException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Ürün bulunamadı.');
}
