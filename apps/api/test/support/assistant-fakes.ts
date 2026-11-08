import { randomUUID } from 'node:crypto';

import type { Database } from '@ambarci/db';
import type {
  ActionSource,
  CreateOperationInput,
  Operation,
  OperationPreview,
  Party,
  Product,
  ProductMovementList,
  ProductStock,
  Warehouse,
} from '@ambarci/shared';
import { HttpStatus } from '@nestjs/common';

import { ApiException } from '../../src/common/api-exception.js';
import type { AiConfig } from '../../src/modules/ai/ai.config.js';
import type { AiRunEntry, AiRunsRepository, DailyTokenUsage } from '../../src/modules/ai/ai-runs.repository.js';
import { AiService } from '../../src/modules/ai/ai.service.js';
import type { CatalogService } from '../../src/modules/catalog/catalog.service.js';
import type { SimilarProduct } from '../../src/modules/catalog/products.repository.js';
import type { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import type { OrganizationContext } from '../../src/modules/organizations/organization-context.js';
import type { OrganizationsService } from '../../src/modules/organizations/organizations.service.js';
import type { StockService } from '../../src/modules/stock/stock.service.js';
import type { OperationActor, OperationsService } from '../../src/modules/operations/operations.service.js';
import type { ProposeToolServices } from '../../src/modules/assistant/tools/propose-tools.js';
import { createProposeTools } from '../../src/modules/assistant/tools/propose-tools.js';
import type { ReadToolServices } from '../../src/modules/assistant/tools/read-tools.js';
import { createReadTools } from '../../src/modules/assistant/tools/read-tools.js';
import { ToolRegistry } from '../../src/modules/assistant/tools/registry.js';
import type { ToolContext } from '../../src/modules/assistant/tools/registry.js';
import type { ScriptedAiProvider } from './scripted-ai-provider.js';

// Asistan testleri için veritabanısız yardımcılar: bellekte ai_runs, okuma servislerinin sahte sürümleri ve iki
// kullanıcılık oturum. Gerçek servislerle aynı sözleşmeyi taklit eder; SQL tarafı test-db/ altında sınanır.

export const ORG = randomUUID();
export const PRODUCT = randomUUID();
export const MAIN = randomUUID();
export const BRANCH = randomUUID();

export const adminContext: ToolContext = {
  organization: { id: ORG, role: 'ADMIN', membershipId: randomUUID() },
  userId: randomUUID(),
};
export const employeeContext: ToolContext = {
  organization: { id: ORG, role: 'EMPLOYEE', membershipId: randomUUID() },
  userId: randomUUID(),
};

/** ai_runs'ın bellek içi sürümü: yazılan kayıtlar ve günlük kullanım. */
export class InMemoryAiRuns implements Pick<AiRunsRepository, 'insert' | 'dailyTokenUsage'> {
  readonly entries: AiRunEntry[] = [];
  usage: DailyTokenUsage = { user: 0, organization: 0 };

  async insert(_executor: unknown, entry: AiRunEntry): Promise<{ id: string; costUsd: string }> {
    this.entries.push(entry);
    return { id: randomUUID(), costUsd: '0' };
  }

  async dailyTokenUsage(): Promise<DailyTokenUsage> {
    return this.usage;
  }
}

export const TEST_AI_CONFIG: AiConfig = {
  apiKey: null,
  chatModel: 'claude-haiku-5-5',
  chatEffort: 'low',
  dailyTokenLimitPerUser: 500_000,
  dailyTokenLimitPerOrganization: 2_000_000,
};

/** Bellek içi ai_runs ile AiService (veritabanı bağlantısı kullanılmaz). */
export function testAiService(provider: ScriptedAiProvider, runs: InMemoryAiRuns): AiService {
  return new AiService({} as unknown as Database, provider, runs as unknown as AiRunsRepository, TEST_AI_CONFIG);
}

const WAREHOUSES: Warehouse[] = [
  { id: MAIN, name: 'Merkez Depo', type: 'WAREHOUSE', isActive: true },
  { id: BRANCH, name: 'Araç 1', type: 'VEHICLE', isActive: true },
  { id: randomUUID(), name: 'Eski Depo', type: 'WAREHOUSE', isActive: false },
];

/** Okuma servislerinin sahtesi. Çalışan yalnızca Merkez Depo'da yetkili; PRODUCT dışındaki ürünler bulunamaz. */
export function fakeReadServices(): { services: ReadToolServices; calls: { productStock: number; search: string[] } } {
  const calls = { productStock: 0, search: [] as string[] };
  const visibleWarehouseIds = async (organization: OrganizationContext): Promise<string[] | null> =>
    organization.role === 'ADMIN' ? null : [MAIN];
  const assertProduct = (productId: string): void => {
    if (productId !== PRODUCT) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Ürün bulunamadı.');
    }
  };

  const catalog: Pick<CatalogService, 'searchSimilarProducts' | 'searchParties'> = {
    async searchSimilarProducts(_organizationId, query): Promise<SimilarProduct[]> {
      calls.search.push(query);
      return [{ id: PRODUCT, sku: 'KBL-NYM-25', name: 'NYM kablo 3x2,5 mm²', baseUnit: 'metre', score: 0.833, matchedAlias: null }];
    },
    async searchParties(_organizationId, search, type): Promise<Party[]> {
      return PARTIES.filter((party) => party.name.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')) && (!type || party.type === type));
    },
  };
  const stock: Pick<StockService, 'productStock' | 'productMovements'> = {
    async productStock(organization, productId): Promise<ProductStock> {
      calls.productStock += 1;
      assertProduct(productId);
      const visible = await visibleWarehouseIds(organization);
      const rows = [
        { warehouse: WAREHOUSES[0] as Warehouse, quantity: '1412.500', averageCost: '10.0000', belowMinimum: false },
        { warehouse: WAREHOUSES[1] as Warehouse, quantity: '40.000', averageCost: '10.0000', belowMinimum: true },
      ].filter((row) => visible === null || visible.includes(row.warehouse.id));
      return { productId, baseUnit: 'metre', minStock: '50.000', total: visible === null ? '1452.500' : '1412.500', warehouses: rows };
    },
    async productMovements(_organization, productId, query): Promise<ProductMovementList> {
      assertProduct(productId);
      return {
        items: [
          {
            id: randomUUID(),
            operationId: randomUUID(),
            lineNo: 1,
            createdAt: '2026-11-05T11:32:00.000Z',
            warehouse: { id: MAIN, name: 'Merkez Depo' },
            type: 'OUT',
            quantityChange: '-12.500',
            unitCost: '10.0000',
            quantityAfter: '1412.500',
            averageCostAfter: '10.0000',
          },
        ],
        total: 1,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  };
  const inventory: Pick<InventoryService, 'listWarehouses'> = {
    async listWarehouses(): Promise<Warehouse[]> {
      return WAREHOUSES;
    },
  };
  const organizations: Pick<OrganizationsService, 'visibleWarehouseIds'> = { visibleWarehouseIds };

  return { services: { catalog, stock, inventory, organizations } as unknown as ReadToolServices, calls };
}

export const PARTY = randomUUID();

/** Sahte servisin aldığı çağrı: hangi işlem, kimin adına, hangi kaynakla açıldı ya da düzenlendi. */
export interface ProposalCall {
  kind: 'create' | 'revise';
  actor: OperationActor;
  input: CreateOperationInput;
  source?: ActionSource;
  sourceMessageId?: string | null;
  operationId?: string;
}

/**
 * Öneri araçlarının servislerinin sahtesi. İşlemi bellekte "açar" ve önizlemeyi (önce → sonra) sabit stoktan üretir:
 * Merkez Depo'da 1.412,5 metre; koli = 100 metre. Çalışan yalnızca Merkez Depo'da işlem açabilir; PRODUCT dışındaki
 * ürünler kalem hatası alır. Stok tablosu yoktur: araçların stoğa yazmadığı gerçek veritabanında sınanır.
 */
export function fakeProposeServices(): { services: ProposeToolServices; calls: ProposalCall[] } {
  const calls: ProposalCall[] = [];
  const opened = new Map<string, { input: CreateOperationInput; version: number }>();

  const check = (actor: OperationActor, input: CreateOperationInput): void => {
    const warehouses = input.items.flatMap((item) => [item.warehouseId, item.targetWarehouseId ?? MAIN]);
    if (actor.kind === 'user' && actor.role !== 'ADMIN' && warehouses.some((id) => id !== MAIN)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'WAREHOUSE_FORBIDDEN', 'Bu depoda işlem yetkiniz yok.');
    }
    const errors = input.items.flatMap((item, index) => {
      if (item.productId !== PRODUCT) {
        return [{ lineNo: index + 1, field: 'productId', code: 'PRODUCT_NOT_FOUND', message: 'Ürün bulunamadı.' }];
      }
      if (item.unit && item.unit !== 'koli' && item.unit !== 'metre') {
        return [{ lineNo: index + 1, field: 'unit', code: 'UNIT_NOT_FOUND', message: 'Ürünün bu birimi yok.' }];
      }
      return [];
    });
    if (errors.length > 0) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'OPERATION_LINES_INVALID', 'İşlemin bazı kalemleri geçersiz.', errors);
    }
  };
  const asOperation = (id: string): Operation => ({ id }) as Operation;

  const operations: Pick<OperationsService, 'create' | 'revise' | 'preview'> = {
    async create(_organizationId, actor, input, source, options) {
      check(actor, input);
      calls.push({ kind: 'create', actor, input, source, sourceMessageId: options?.sourceMessageId });
      const id = randomUUID();
      opened.set(id, { input, version: 1 });
      return asOperation(id);
    },
    async revise(_organizationId, actor, operationId, input) {
      check(actor, input);
      calls.push({ kind: 'revise', actor, input, operationId });
      const current = opened.get(operationId);
      if (!current) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'OPERATION_NOT_FOUND', 'İşlem bulunamadı.');
      }
      opened.set(operationId, { input, version: current.version + 1 });
      return asOperation(operationId);
    },
    async preview(_organizationId, _actor, operationId): Promise<OperationPreview> {
      const current = opened.get(operationId);
      if (!current) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'OPERATION_NOT_FOUND', 'İşlem bulunamadı.');
      }
      const { input, version } = current;
      const warehouse = (id: string): { id: string; name: string } => ({ id, name: id === MAIN ? 'Merkez Depo' : 'Araç 1' });
      return {
        operationId,
        type: input.type,
        status: 'PENDING_CONFIRMATION',
        version,
        partyId: input.partyId ?? null,
        partyName: input.partyId ? 'Yıldız Yapı İnşaat' : null,
        note: input.note ?? null,
        createdAt: '2026-11-09T09:00:00.000Z',
        lines: input.items.map((item, index) => {
          const base = item.unit === 'koli' ? `${item.quantity}00.000` : `${item.quantity}`;
          const out = input.type !== 'STOCK_IN';
          return {
            lineNo: index + 1,
            productId: item.productId,
            sku: 'KBL-NYM-25',
            productName: 'NYM kablo 3x2,5 mm²',
            baseUnit: 'metre',
            quantity: item.quantity,
            unit: item.unit === 'metre' ? null : (item.unit ?? null),
            baseQuantity: base,
            unitCost: item.unitCost ?? null,
            warehouse: warehouse(item.warehouseId),
            targetWarehouse: item.targetWarehouseId ? warehouse(item.targetWarehouseId) : null,
            // Önizleme sayıları sabit: 1.412,5 → çıkışta 1.212,5, girişte 1.612,5 (test yalnızca biçime bakar).
            // Miktar "5000" ise stok yetmez: 1.412,5 var, sonrası eksi çıkar (önizleme ucunun verdiği gibi).
            stock:
              out && item.quantity === '5000'
                ? { before: '1412.500', after: '-3587.500', sufficient: false }
                : { before: '1412.500', after: out ? '1212.500' : '1612.500', sufficient: true },
            targetStock: item.targetWarehouseId ? { before: '0.000', after: '200.000', sufficient: true } : null,
          };
        }),
      };
    },
  };

  const catalog: Pick<CatalogService, 'findProduct'> = {
    async findProduct(_organizationId, productId): Promise<Product | null> {
      if (productId !== PRODUCT) {
        return null;
      }
      return {
        id: PRODUCT,
        sku: 'KBL-NYM-25',
        name: 'NYM kablo 3x2,5 mm²',
        baseUnit: 'metre',
        units: [{ unit: 'koli', factor: '100.000000', barcode: null }],
      } as unknown as Product;
    },
  };

  return { services: { operations, catalog } as unknown as ProposeToolServices, calls };
}

/** Uygulamadaki gibi tam kayıt defteri: önce okuma, sonra öneri araçları (sahte servislerle). */
export function fullRegistry(): {
  registry: ToolRegistry;
  readCalls: ReturnType<typeof fakeReadServices>['calls'];
  proposals: ProposalCall[];
} {
  const read = fakeReadServices();
  const propose = fakeProposeServices();
  return {
    registry: new ToolRegistry([...createReadTools(read.services), ...createProposeTools(propose.services)]),
    readCalls: read.calls,
    proposals: propose.calls,
  };
}

/** search_parties için sahte cari listesi (yalnızca fakeReadServices'in katalog sahtesine eklenir). */
export const PARTIES: Party[] = [{ id: PARTY, name: 'Yıldız Yapı İnşaat', type: 'CUSTOMER', taxId: null, isActive: true }];
