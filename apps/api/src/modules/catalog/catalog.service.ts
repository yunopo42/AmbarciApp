import type { DbExecutor } from '@ambarci/db';
import type { ProductList, ProductListQuery } from '@ambarci/shared';
import { Inject, Injectable } from '@nestjs/common';

import { CatalogRepository } from './catalog.repository.js';
import type { ProductSummary, UnitConversion, UnitConversionInput } from './catalog.repository.js';
import { ProductsRepository } from './products.repository.js';

/** Diğer modüllerin katalog tablolarına erişim yolu (modül sınırı: tablolar yalnızca bu modülün repository'sinde). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(CatalogRepository) private readonly repository: CatalogRepository,
    @Inject(ProductsRepository) private readonly products: ProductsRepository,
  ) {}

  convertToBaseUnits(
    executor: DbExecutor,
    organizationId: string,
    lines: UnitConversionInput[],
  ): Promise<UnitConversion[]> {
    return this.repository.convertToBaseUnits(executor, organizationId, lines);
  }

  isActiveParty(executor: DbExecutor, organizationId: string, partyId: string): Promise<boolean> {
    return this.repository.isActiveParty(executor, organizationId, partyId);
  }

  findPartyName(executor: DbExecutor, organizationId: string, partyId: string): Promise<string | null> {
    return this.repository.findPartyName(executor, organizationId, partyId);
  }

  /** Ürünün ana birimi ve kritik eşiği; ürün bu şirkette yoksa (başka şirketinki de) null. */
  findProductSummary(executor: DbExecutor, organizationId: string, productId: string): Promise<ProductSummary | null> {
    return this.repository.findProductSummary(executor, organizationId, productId);
  }

  /** Ürün listesi (arama ve sayfalama ürün yönetimindekiyle aynı); depo bazında stok listesi bunun üzerine kurulur. */
  listProducts(organizationId: string, query: ProductListQuery): Promise<ProductList> {
    return this.products.list(organizationId, query);
  }
}
