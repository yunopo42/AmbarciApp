import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

/**
 * Stok okuma ekranlarının uçları (depo bazında stok, ürün hareket geçmişi). catalog zaten inventory'ye bağlı;
 * stok listesi ürün bilgisini de istediği için inventory'nin catalog'a bağlanması döngü olurdu. Bu yüzden ikisini
 * kullanan ayrı bir modül.
 */
@Module({
  imports: [OrganizationsModule, CatalogModule, InventoryModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
