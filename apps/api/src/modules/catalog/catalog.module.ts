import { Module } from '@nestjs/common';

import { InventoryModule } from '../inventory/inventory.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';
import { PartiesController } from './parties.controller.js';
import { PartiesRepository } from './parties.repository.js';
import { PartiesService } from './parties.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

/**
 * Ürünler, birimler, alternatif adlar ve cariler. Ürünün hareketi olup olmadığını (ana birim kilidi) inventory
 * modülünün servisinden öğrenir; hareket tablosuna doğrudan bakmaz. Excel/CSV içe aktarma #39'da gelir.
 */
@Module({
  // Şirket bağlamı guard'ları OrganizationsService'i kullanır.
  imports: [OrganizationsModule, InventoryModule],
  controllers: [ProductsController, PartiesController],
  providers: [CatalogRepository, CatalogService, ProductsRepository, ProductsService, PartiesRepository, PartiesService],
  exports: [CatalogService],
})
export class CatalogModule {}
