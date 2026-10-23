import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ApplyStockService } from './apply-stock.service.js';
import { InventoryService } from './inventory.service.js';
import { StockLedgerRepository } from './stock-ledger.repository.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesRepository } from './warehouses.repository.js';

/**
 * Depolar, stok, hareketler ve stok uygulama transaction'ının stok kısmı (ApplyStockService). Onay uç noktası
 * operations modülündedir; o modül stoğu yalnızca ApplyStockService üzerinden değiştirir.
 */
@Module({
  // Şirket bağlamı guard'ları OrganizationsService'i kullanır.
  imports: [OrganizationsModule],
  controllers: [WarehousesController],
  providers: [WarehousesRepository, StockLedgerRepository, ApplyStockService, InventoryService],
  exports: [ApplyStockService, InventoryService],
})
export class InventoryModule {}
