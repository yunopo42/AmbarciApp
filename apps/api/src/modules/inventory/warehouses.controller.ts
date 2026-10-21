import type { Warehouse, WarehouseType } from '@ambarci/shared';
import { Controller, Get, HttpStatus, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ApiException } from '../../common/api-exception.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { WarehousesRepository } from './warehouses.repository.js';

// Swagger için sınıf karşılığı; alanlar packages/shared içindeki warehouseSchema ile aynı kalmak zorunda.
export class WarehouseDto implements Warehouse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Merkez Depo' })
  name!: string;

  @ApiProperty({ enum: ['WAREHOUSE', 'BRANCH', 'VEHICLE'] })
  type!: WarehouseType;

  @ApiProperty()
  isActive!: boolean;
}

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(@Inject(WarehousesRepository) private readonly warehouses: WarehousesRepository) {}

  @Get()
  @OrganizationScoped()
  @ApiOperation({ summary: 'Aktif şirketin depoları' })
  @ApiOkResponse({ type: [WarehouseDto] })
  list(@CurrentOrganization() organization: OrganizationContext): Promise<WarehouseDto[]> {
    return this.warehouses.listByOrganization(organization.id);
  }

  @Get(':warehouseId')
  @OrganizationScoped({ warehouseParam: 'warehouseId' })
  @ApiOperation({
    summary: 'Depo ayrıntısı; çalışan yalnızca yetkili olduğu depoyu görür (stok bilgisi 3. haftada eklenecek)',
  })
  @ApiOkResponse({ type: WarehouseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  async get(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
  ): Promise<WarehouseDto> {
    const warehouse = await this.warehouses.findById(organization.id, warehouseId);
    if (!warehouse) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'WAREHOUSE_NOT_FOUND', 'Depo bulunamadı.');
    }
    return warehouse;
  }
}
