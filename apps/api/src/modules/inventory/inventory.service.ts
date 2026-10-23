import type { DbExecutor } from '@ambarci/db';
import { Inject, Injectable } from '@nestjs/common';

import { WarehousesRepository } from './warehouses.repository.js';

/** Diğer modüllerin depo bilgisine erişim yolu. Stok uygulaması ApplyStockService'tedir. */
@Injectable()
export class InventoryService {
  constructor(@Inject(WarehousesRepository) private readonly warehouses: WarehousesRepository) {}

  findWarehouseStatuses(
    executor: DbExecutor,
    organizationId: string,
    warehouseIds: string[],
  ): Promise<{ id: string; isActive: boolean }[]> {
    return this.warehouses.findStatuses(executor, organizationId, warehouseIds);
  }
}
