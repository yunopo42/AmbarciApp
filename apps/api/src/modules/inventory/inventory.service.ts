import type { Database, DbExecutor } from '@ambarci/db';
import type { Movement, OperationType, ProductMovement, StockEffect, Warehouse, WarehouseInput } from '@ambarci/shared';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import type { ReversalStep } from './apply-stock.service.js';
import { StockLedgerRepository } from './stock-ledger.repository.js';
import type {
  BelowMinimumRow,
  MovementFilter,
  PreviewedEffect,
  ProductWarehouseStockRow,
  StockLevelRow,
} from './stock-ledger.repository.js';
import { reversalEffectsOf, stockEffectsOf } from './stock-preview.js';
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

  /** Şirketin depoları, ada göre (pasifler dahil; süzme çağıranda). */
  listWarehouses(organizationId: string): Promise<Warehouse[]> {
    return this.warehouses.listByOrganization(organizationId);
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
    return effectMap(await this.ledger.previewEffects(executor, organizationId, stockEffectsOf(type, lines)));
  }

  /** Ters kayıt onaylanırsa stoğun nasıl değişeceği (#78); anahtarlar previewStock'takiyle aynı. */
  async previewReversal(executor: DbExecutor, organizationId: string, steps: ReversalStep[]): Promise<Map<string, StockEffect>> {
    return effectMap(await this.ledger.previewEffects(executor, organizationId, reversalEffectsOf(steps)));
  }

  /** İşlemin yazılmış hareketleri, kalem ve yazılma sırasıyla (ters kaydın kaynağı, #78). */
  listMovements(executor: DbExecutor, organizationId: string, operationId: string): Promise<Movement[]> {
    return this.ledger.listByOperation(executor, organizationId, operationId);
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
    filter: MovementFilter,
  ): Promise<{ items: ProductMovement[]; total: number }> {
    return this.ledger.listProductMovements(this.db, organizationId, productId, filter);
  }

  /** Şirketin son hareketleri, bütün ürünlerde (gösterge paneli). */
  listRecentMovements(
    organizationId: string,
    filter: MovementFilter,
  ): Promise<{ items: (ProductMovement & { productId: string })[]; total: number }> {
    return this.ledger.listRecentMovements(this.db, organizationId, filter);
  }

  /** Verilen ürünlerden aktif depolarda kritik eşiğin altına düşenler (gösterge paneli). */
  listBelowMinimum(
    organizationId: string,
    products: { productId: string; minStock: string }[],
    filter: MovementFilter,
  ): Promise<{ items: BelowMinimumRow[]; total: number }> {
    return this.ledger.listBelowMinimum(this.db, organizationId, products, filter);
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

/** Önizlenen etkiler, kalem ve taraf anahtarıyla ("lineNo:source", "lineNo:target"). */
function effectMap(rows: PreviewedEffect[]): Map<string, StockEffect> {
  return new Map(rows.map((row) => [`${row.lineNo}:${row.side}`, { before: row.before, after: row.after, sufficient: row.sufficient }]));
}
