import type { Database } from '@ambarci/db';
import type { ProductMovementList, ProductMovementQuery, StockListQuery, WarehouseStock } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { DATABASE } from '../../database/database.module.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { OrganizationsService } from '../organizations/organizations.service.js';

/**
 * Stoğu okuyan ekranlar: depo bazında stok listesi ve ürünün hareket geçmişi. Ürün bilgisi catalog, stok ve
 * hareketler inventory modülünde; bu servis ikisini servisleri üzerinden birleştirir, tablolara doğrudan bakmaz
 * (modül sınırı). Stoğa yazmaz.
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(OrganizationsService) private readonly organizations: OrganizationsService,
  ) {}

  /**
   * Depodaki stok: aktif ürünler (ürün listesindeki arama ve sayfalama) ve her birinin bu depodaki miktarı.
   * Depoda hiç hareketi olmayan ürün 0 görünür. Çalışanın depo yetkisi controller'daki guard'da denetlenir.
   */
  async warehouseStock(organizationId: string, warehouseId: string, query: StockListQuery): Promise<WarehouseStock> {
    const warehouse = await this.inventory.getWarehouse(organizationId, warehouseId);
    const products = await this.catalog.listProducts(organizationId, { ...query, status: 'active' });
    const levels = await this.inventory.stockLevels(
      organizationId,
      warehouseId,
      products.items.map((product) => ({ productId: product.id, minStock: product.minStock })),
    );
    const levelOf = new Map(levels.map((level) => [level.productId, level]));
    return {
      warehouse,
      items: products.items.map((product) => {
        const level = levelOf.get(product.id);
        if (!level) {
          throw new Error(`Ürünün stok satırı hesaplanmadı (${product.id}).`);
        }
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          baseUnit: product.baseUnit,
          minStock: product.minStock,
          quantity: level.quantity,
          averageCost: level.averageCost,
          belowMinimum: level.belowMinimum,
        };
      }),
      total: products.total,
      page: products.page,
      pageSize: products.pageSize,
    };
  }

  /**
   * Ürünün hareketleri, en yeni önce. Yönetici bütün depoların, çalışan yalnızca yetkili olduğu depoların
   * hareketlerini görür (depo bazında stok listesiyle aynı kural). Başka şirketin ürünü 404.
   */
  async productMovements(
    organization: OrganizationContext,
    productId: string,
    query: ProductMovementQuery,
  ): Promise<ProductMovementList> {
    if (!(await this.catalog.productExists(this.db, organization.id, productId))) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Ürün bulunamadı.');
    }
    const warehouseIds = await this.organizations.visibleWarehouseIds(organization);
    const { items, total } = await this.inventory.listProductMovements(organization.id, productId, {
      warehouseIds,
      warehouseId: query.warehouseId?.toLowerCase(),
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
