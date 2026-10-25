import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { ProductImportModule } from './modules/product-import/product-import.module.js';
import { StockModule } from './modules/stock/stock.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    InventoryModule,
    CatalogModule,
    OperationsModule,
    StockModule,
    ProductImportModule,
  ],
})
export class AppModule {}
