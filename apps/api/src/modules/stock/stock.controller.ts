import {
  criticalStockQuerySchema,
  movementListQuerySchema,
  productMovementQuerySchema,
  stockListQuerySchema,
} from '@ambarci/shared';
import type { CriticalStockQuery, MovementListQuery, ProductMovementQuery, StockListQuery } from '@ambarci/shared';
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import {
  CriticalStockListDto,
  ProductMovementListDto,
  ProductStockDto,
  RecentMovementListDto,
  WarehouseStockDto,
} from './stock.dto.js';
import { StockService } from './stock.service.js';

/** Stoğu okuyan uçlar. Stok yalnızca işlem onayıyla değişir (POST /v1/operations/{id}/confirm). */
@ApiTags('stock')
@ApiBearerAuth()
@Controller()
export class StockController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  @Get('warehouses/:warehouseId/stock')
  @OrganizationScoped({ warehouseParam: 'warehouseId' })
  @ApiOperation({
    summary: 'Depodaki stok: aktif ürünler ve miktarları; çalışan yalnızca yetkili olduğu depoyu görür',
  })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Ad, SKU, barkod ya da alternatif ad' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: WarehouseStockDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  warehouseStock(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query(new ZodValidationPipe(stockListQuerySchema)) query: StockListQuery,
  ): Promise<WarehouseStockDto> {
    return this.stock.warehouseStock(organization.id, warehouseId, query);
  }

  @Get('products/:productId/stock')
  @OrganizationScoped()
  @ApiOperation({
    summary: 'Ürünün depolara göre stoğu ve toplamı; çalışan yalnızca yetkili olduğu depoları görür',
  })
  @ApiOkResponse({ type: ProductStockDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  productStock(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductStockDto> {
    return this.stock.productStock(organization, productId);
  }

  @Get('products/:productId/movements')
  @OrganizationScoped()
  @ApiOperation({
    summary: 'Ürünün hareket geçmişi, en yeni önce; çalışan yalnızca yetkili olduğu depoların hareketlerini görür',
  })
  @ApiQuery({ name: 'warehouseId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: ProductMovementListDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  productMovements(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query(new ZodValidationPipe(productMovementQuerySchema)) query: ProductMovementQuery,
  ): Promise<ProductMovementListDto> {
    return this.stock.productMovements(organization, productId, query);
  }

  @Get('stock/critical')
  @OrganizationScoped()
  @ApiOperation({
    summary:
      'Kritik stoktaki ürünler, depo bazında: eşiği tanımlı aktif ürünlerin aktif depolarda eşiğin altına düşen stoğu; çalışan yalnızca yetkili olduğu depoları görür',
  })
  @ApiQuery({ name: 'warehouseId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: CriticalStockListDto })
  criticalStock(
    @CurrentOrganization() organization: OrganizationContext,
    @Query(new ZodValidationPipe(criticalStockQuerySchema)) query: CriticalStockQuery,
  ): Promise<CriticalStockListDto> {
    return this.stock.criticalStock(organization, query);
  }

  @Get('movements')
  @OrganizationScoped()
  @ApiOperation({
    summary: 'Şirketin son stok hareketleri, en yeni önce; çalışan yalnızca yetkili olduğu depoların hareketlerini görür',
  })
  @ApiQuery({ name: 'warehouseId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: RecentMovementListDto })
  recentMovements(
    @CurrentOrganization() organization: OrganizationContext,
    @Query(new ZodValidationPipe(movementListQuerySchema)) query: MovementListQuery,
  ): Promise<RecentMovementListDto> {
    return this.stock.recentMovements(organization, query);
  }
}
