import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { EventsModule } from '../events/events.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

/**
 * İşlemler: açma, onay, iptal ve durum makinesi. Onay transaction'ını bu modül yönetir; her modül kendi tablosuna
 * kendi servisiyle yazar (stok: inventory, denetim: audit, outbox: events) ve hepsi aynı transaction'ı kullanır.
 */
@Module({
  imports: [OrganizationsModule, InventoryModule, CatalogModule, AuditModule, EventsModule],
  controllers: [OperationsController],
  providers: [OperationsRepository, OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
