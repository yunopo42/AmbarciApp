import {
  formatDecimal,
  getStockToolInputSchema,
  listRecentMovementsToolInputSchema,
  listWarehousesToolInputSchema,
  MOVEMENT_TYPE_LABELS,
  searchProductsToolInputSchema,
  WAREHOUSE_TYPE_LABELS,
} from '@ambarci/shared';
import type { ProductMovementQuery } from '@ambarci/shared';
import { HttpStatus } from '@nestjs/common';

import { ApiException } from '../../../common/api-exception.js';
import type { CatalogService } from '../../catalog/catalog.service.js';
import type { InventoryService } from '../../inventory/inventory.service.js';
import type { OrganizationContext } from '../../organizations/organization-context.js';
import type { OrganizationsService } from '../../organizations/organizations.service.js';
import type { StockService } from '../../stock/stock.service.js';
import { defineTool } from './registry.js';
import type { RegisteredTool } from './registry.js';

// Asistanın okuma araçları (4. hafta). Hiçbiri yazmaz; veriyi ekranların kullandığı okuma servislerinden alır, böylece
// depo yetkisi gibi kurallar ekranlarla aynıdır: çalışan yalnızca yetkili olduğu depoları görür, başka şirketin kaydı
// "bulunamadı" görünür. Şirket ve kullanıcı ToolContext'ten (oturumdan) gelir.
//
// Miktarlar modele Türkçe yazımla verilir (formatDecimal: "1412.500" → "1.412,5"). Veritabanındaki "120.000" metni
// Türkçede yüz yirmi bin diye okunur; model bunu kullanıcıya olduğu gibi aktarabilirdi.

const EVERY_ROLE = ['ADMIN', 'EMPLOYEE'] as const;
const SEARCH_LIMIT = 5;
const DEFAULT_MOVEMENT_LIMIT = 10;

const dateTime = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export interface ReadToolServices {
  catalog: CatalogService;
  stock: StockService;
  inventory: InventoryService;
  organizations: OrganizationsService;
}

/**
 * Çalışan, yetkisi olmayan bir depoyu soramaz. Yönetici bütün depoları görür. Depo hiç yoksa ya da başka şirketinse
 * çalışan da "yetkiniz yok" alır; aynı şirketin depo kimliğini bilmek bir sızıntı değildir.
 */
async function assertWarehouseVisible(
  organizations: OrganizationsService,
  organization: OrganizationContext,
  warehouseId: string | undefined,
): Promise<void> {
  if (!warehouseId) {
    return;
  }
  const visible = await organizations.visibleWarehouseIds(organization);
  if (visible && !visible.includes(warehouseId)) {
    throw new ApiException(HttpStatus.FORBIDDEN, 'WAREHOUSE_FORBIDDEN', 'Kullanıcının bu depoyu görme yetkisi yok.');
  }
}

/** Araç kayıt defterindeki sırayla (sıra modele giden araç listesini belirler ve sabit kalmalı). */
export function createReadTools(services: ReadToolServices): RegisteredTool[] {
  const { catalog, stock, inventory, organizations } = services;

  const searchProducts = defineTool({
    name: 'search_products',
    description:
      'Katalogda ürün arar: ad ve sahada kullanılan alternatif adlarda yazım hatalarına dayanıklı benzerlik araması, stok kodu ve barkodda tam eşleşme. En iyi 5 adayı 0–1 arası skorla döndürür (1 tam eşleşme). matched_alias doluysa aday o alternatif adla bulunmuştur. Kullanıcının söylediği ürün adını ölçü ve özellikleriyle birlikte sorgu olarak ver.',
    statusLabel: 'Ürün aranıyor',
    toolClass: 'read',
    allowedRoles: EVERY_ROLE,
    input: searchProductsToolInputSchema,
    async run(input, { organization }) {
      const candidates = await catalog.searchSimilarProducts(organization.id, input.query, SEARCH_LIMIT);
      return {
        candidates: candidates.map((candidate) => ({
          product_id: candidate.id,
          sku: candidate.sku,
          name: candidate.name,
          base_unit: candidate.baseUnit,
          score: candidate.score,
          matched_alias: candidate.matchedAlias,
        })),
      };
    },
  });

  const listWarehouses = defineTool({
    name: 'list_warehouses',
    description: 'Kullanıcının görebildiği aktif depoları (depo, şube, araç) kimlik ve türüyle listeler.',
    statusLabel: 'Depolar getiriliyor',
    toolClass: 'read',
    allowedRoles: EVERY_ROLE,
    input: listWarehousesToolInputSchema,
    async run(_input, { organization }) {
      const [all, visible] = await Promise.all([
        inventory.listWarehouses(organization.id),
        organizations.visibleWarehouseIds(organization),
      ]);
      return {
        warehouses: all
          .filter((warehouse) => warehouse.isActive && (visible === null || visible.includes(warehouse.id)))
          .map((warehouse) => ({
            warehouse_id: warehouse.id,
            name: warehouse.name,
            type: WAREHOUSE_TYPE_LABELS[warehouse.type],
          })),
      };
    },
  });

  const getStock = defineTool({
    name: 'get_stock',
    description:
      'Bir ürünün depolardaki güncel stoğunu ve toplamını ürünün ana biriminde döndürür. warehouse_id verilmezse kullanıcının görebildiği bütün depolar ve onların toplamı döner. Miktarlar Türkçe yazımla gelir (binlik ayırıcı nokta, ondalık ayırıcı virgül); kendin toplama ya da çevirme yapma.',
    statusLabel: 'Stok sorgulanıyor',
    toolClass: 'read',
    allowedRoles: EVERY_ROLE,
    input: getStockToolInputSchema,
    async run(input, { organization }) {
      await assertWarehouseVisible(organizations, organization, input.warehouse_id);
      const result = await stock.productStock(organization, input.product_id);
      const rows = input.warehouse_id
        ? result.warehouses.filter((row) => row.warehouse.id === input.warehouse_id)
        : result.warehouses;
      const [only] = rows;
      if (input.warehouse_id && !only) {
        throw new ApiException(HttpStatus.NOT_FOUND, 'WAREHOUSE_NOT_FOUND', 'Depo bulunamadı ya da pasif.');
      }
      return {
        product_id: result.productId,
        base_unit: result.baseUnit,
        min_stock: result.minStock === null ? null : formatDecimal(result.minStock),
        // Toplam SQL'de hesaplanır; tek depo sorulduysa o deponun miktarıdır.
        total: formatDecimal(only && input.warehouse_id ? only.quantity : result.total),
        warehouses: rows.map((row) => ({
          warehouse_id: row.warehouse.id,
          name: row.warehouse.name,
          type: WAREHOUSE_TYPE_LABELS[row.warehouse.type],
          quantity: formatDecimal(row.quantity),
          below_min_stock: row.belowMinimum,
        })),
      };
    },
  });

  const listRecentMovements = defineTool({
    name: 'list_recent_movements',
    description:
      'Bir ürünün son stok hareketlerini (giriş, çıkış, transfer, sayım, fire) en yeniden eskiye döndürür. Tarihler Türkiye saatiyle; quantity_change ana birimde ve işaretli (+ giriş, − çıkış), quantity_after hareketten sonraki stok.',
    statusLabel: 'Hareketler getiriliyor',
    toolClass: 'read',
    allowedRoles: EVERY_ROLE,
    input: listRecentMovementsToolInputSchema,
    async run(input, { organization }) {
      await assertWarehouseVisible(organizations, organization, input.warehouse_id);
      const query: ProductMovementQuery = { page: 1, pageSize: input.limit ?? DEFAULT_MOVEMENT_LIMIT };
      if (input.warehouse_id) {
        query.warehouseId = input.warehouse_id;
      }
      const result = await stock.productMovements(organization, input.product_id, query);
      return {
        product_id: input.product_id,
        total: result.total,
        movements: result.items.map((movement) => ({
          date: dateTime.format(new Date(movement.createdAt)),
          warehouse: movement.warehouse.name,
          type: MOVEMENT_TYPE_LABELS[movement.type],
          quantity_change: formatDecimal(movement.quantityChange, { signed: true }),
          quantity_after: formatDecimal(movement.quantityAfter),
        })),
      };
    },
  });

  return [searchProducts, listWarehouses, getStock, listRecentMovements];
}
