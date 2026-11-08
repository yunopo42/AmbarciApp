import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { OperationsModule } from '../operations/operations.module.js';
import { OperationsService } from '../operations/operations.service.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { OrganizationsService } from '../organizations/organizations.service.js';
import { StockModule } from '../stock/stock.module.js';
import { StockService } from '../stock/stock.service.js';
import { AgentLoop } from './agent-loop.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsRepository } from './conversations.repository.js';
import { ConversationsService } from './conversations.service.js';
import { createProposeTools } from './tools/propose-tools.js';
import { createReadTools } from './tools/read-tools.js';
import { ToolRegistry } from './tools/registry.js';

/**
 * Asistan: sohbet uçları ve cevabın akışı (SSE), ajan döngüsü ve araç kayıt defteri. Sohbet ve mesaj tabloları bu
 * modülündür. Araçlar veriyi diğer modüllerin servislerinden okur (modül sınırı); öneri araçları işlemi
 * OperationsService ile onay bekleyen olarak açar, onaylamaz. Model yalnızca ai modülünden (AiService) çağrılır.
 */
@Module({
  imports: [AiModule, CatalogModule, InventoryModule, OperationsModule, OrganizationsModule, StockModule],
  controllers: [ConversationsController],
  providers: [
    {
      provide: ToolRegistry,
      // Sıra sabit: önce okuma, sonra öneri araçları. Her prompt sürümü bu listeden kendi araçlarını seçer.
      useFactory: (
        catalog: CatalogService,
        stock: StockService,
        inventory: InventoryService,
        organizations: OrganizationsService,
        operations: OperationsService,
      ): ToolRegistry =>
        new ToolRegistry([
          ...createReadTools({ catalog, stock, inventory, organizations }),
          ...createProposeTools({ operations, catalog }),
        ]),
      inject: [CatalogService, StockService, InventoryService, OrganizationsService, OperationsService],
    },
    AgentLoop,
    ConversationsRepository,
    ConversationsService,
  ],
})
export class AssistantModule {}
