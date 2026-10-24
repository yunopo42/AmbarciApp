import type { Database, DbExecutor } from '@ambarci/db';
import type { OperationType, ProductMovement, StockEffect, Warehouse, WarehouseInput } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import { StockLedgerRepository } from './stock-ledger.repository.js';
import type { ProductWarehouseStockRow, StockLevelRow } from './stock-ledger.repository.js';
import { stockEffectsOf } from './stock-preview.js';
import type { PreviewLine } from './stock-preview.js';
import { WarehousesRepository } from './warehouses.repository.js';
import type { WarehouseStatus } from './warehouses.repository.js';

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
  ): Promise<WarehouseStatus[]> {
    return this.warehouses.findStatuses(executor, organizationId, warehouseIds);
  }

  async getWarehouse(organizationId: string, warehouseId: string): Promise<Warehouse> {
    const warehouse = await this.warehouses.findById(organizationId, warehouseId);
    if (!warehouse) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'WAREHOUSE_NOT_FOUND', 'Depo bulunamadı.');
    }
    return warehouse;
  }

  /**
   * İşlem onaylanırsa stoğun nasıl değişeceği: kalem ve taraf ("lineNo:source", "lineNo:target") başına önce,
   * sonra ve yeterlilik. Hesap SQL'de; stok kilitlenmez.
   */
  async previewStock(
    executor: DbExecutor,
    organizationId: string,
    type: OperationType,
    lines: PreviewLine[],
  ): Promise<Map<string, StockEffect>> {
    const rows = await this.ledger.previewEffects(executor, organizationId, stockEffectsOf(type, lines));
    return new Map(rows.map((row) => [`${row.lineNo}:${row.side}`, { before: row.before, after: row.after, sufficient: row.sufficient }]));
  }

  stockLevels(
    organizationId: string,
    warehouseId: string,
    products: { productId: string; minStock: string | null }[],
  ): Promise<StockLevelRow[]> {
    return this.ledger.stockLevels(this.db, organizationId, warehouseId, products);
  }

  productStockByWarehouse(
    organizationId: string,
    product: { productId: string; minStock: string | null },
    warehouseIds: string[] | null,
  ): Promise<ProductWarehouseStockRow[]> {
    return this.ledger.productStockByWarehouse(this.db, organizationId, product, warehouseIds);
  }

  listProductMovements(
    organizationId: string,
    productId: string,
    filter: { warehouseIds: string[] | null; warehouseId?: string | undefined; page: number; pageSize: number },
  ): Promise<{ items: ProductMovement[]; total: number }> {
    return this.ledger.listProductMovements(this.db, organizationId, productId, filter);
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
