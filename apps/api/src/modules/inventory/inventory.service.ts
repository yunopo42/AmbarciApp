import type { Database, DbExecutor } from '@ambarci/db';
import type { Warehouse, WarehouseInput } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import { StockLedgerRepository } from './stock-ledger.repository.js';
import { WarehousesRepository } from './warehouses.repository.js';

/** Depo yönetimi ve diğer modüllerin depo/stok bilgisine erişim yolu. Stok uygulaması ApplyStockService'tedir. */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WarehousesRepository) private readonly warehouses: WarehousesRepository,
    @Inject(StockLedgerRepository) private readonly ledger: StockLedgerRepository,
  ) {}

  findWarehouseStatuses(
    executor: DbExecutor,
    organizationId: string,
    warehouseIds: string[],
  ): Promise<{ id: string; isActive: boolean }[]> {
    return this.warehouses.findStatuses(executor, organizationId, warehouseIds);
  }

  productHasMovements(organizationId: string, productId: string): Promise<boolean> {
    return this.ledger.productHasMovements(this.db, organizationId, productId);
  }

  createWarehouse(organizationId: string, input: WarehouseInput): Promise<Warehouse> {
    return withNameConflict(() => this.warehouses.create(organizationId, input));
  }

  async updateWarehouse(organizationId: string, warehouseId: string, input: WarehouseInput): Promise<Warehouse> {
    const warehouse = await withNameConflict(() => this.warehouses.update(organizationId, warehouseId, input));
    if (!warehouse) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'WAREHOUSE_NOT_FOUND', 'Depo bulunamadı.');
    }
    return warehouse;
  }
}

/** Aynı şirkette aynı depo adı ikinci kez kullanılamaz (warehouses_org_name_key): asistan depoyu adıyla bulur. */
async function withNameConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (postgresErrorOf(error).constraint === 'warehouses_org_name_key') {
      throw new ApiException(HttpStatus.CONFLICT, 'WAREHOUSE_NAME_TAKEN', 'Bu adla bir depo zaten var.');
    }
    throw error;
  }
}
