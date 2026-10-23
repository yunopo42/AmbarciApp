import { Module } from '@nestjs/common';

import { CatalogRepository } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';

/** Ürünler, birimler, alternatif adlar ve cariler. Yönetim uçları ve içe aktarma #36 ve #39'da gelir. */
@Module({
  providers: [CatalogRepository, CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
