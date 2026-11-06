import { randomUUID } from 'node:crypto';

import type { Database } from '@ambarci/db';
import type { ProductMovementList, ProductStock, Warehouse } from '@ambarci/shared';
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
import type { ReadToolServices } from '../../src/modules/assistant/tools/read-tools.js';
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

  const catalog: Pick<CatalogService, 'searchSimilarProducts'> = {
    async searchSimilarProducts(_organizationId, query): Promise<SimilarProduct[]> {
      calls.search.push(query);
      return [{ id: PRODUCT, sku: 'KBL-NYM-25', name: 'NYM kablo 3x2,5 mm²', baseUnit: 'metre', score: 0.833, matchedAlias: null }];
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
