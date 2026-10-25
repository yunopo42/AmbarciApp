import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ProductImportController } from './product-import.controller.js';
import { ProductImportService } from './product-import.service.js';

/**
 * Ürün içe aktarma (ADR-004). Ürünleri catalog'un, açılış işlemini operations'ın servisiyle aynı transaction'da yazar.
 * operations zaten catalog'a bağlı olduğu için bu iş catalog'un içinde yapılamazdı (döngü); ikisini kullanan ayrı modül.
 */
@Module({
  imports: [OrganizationsModule, CatalogModule, OperationsModule],
  controllers: [ProductImportController],
  providers: [ProductImportService],
})
export class ProductImportModule {}
