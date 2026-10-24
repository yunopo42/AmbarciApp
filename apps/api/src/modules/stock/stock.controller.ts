import { productMovementQuerySchema, stockListQuerySchema } from '@ambarci/shared';
import type { ProductMovementQuery, StockListQuery } from '@ambarci/shared';
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { ProductMovementListDto, WarehouseStockDto } from './stock.dto.js';
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
}
