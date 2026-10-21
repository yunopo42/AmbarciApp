import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module.js';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesRepository } from './warehouses.repository.js';

/** Depolar; stok, hareketler ve stok transaction'ı 3. haftada bu modüle eklenecek. */
@Module({
  // Şirket bağlamı guard'ları OrganizationsService'i kullanır.
  imports: [OrganizationsModule],
  controllers: [WarehousesController],
  providers: [WarehousesRepository],
})
export class InventoryModule {}
