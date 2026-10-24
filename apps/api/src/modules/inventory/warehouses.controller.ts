import { warehouseInputSchema } from '@ambarci/shared';
import type { Warehouse, WarehouseInput, WarehouseType } from '@ambarci/shared';
import { Body, Controller, Get, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ApiException } from '../../common/api-exception.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { InventoryService } from './inventory.service.js';
import { WarehousesRepository } from './warehouses.repository.js';

const WAREHOUSE_TYPES: WarehouseType[] = ['WAREHOUSE', 'BRANCH', 'VEHICLE'];

// Swagger için sınıf karşılığı; alanlar packages/shared içindeki warehouseInputSchema ile aynı kalmak zorunda.
export class WarehouseInputDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Ostim Depo', description: 'Şirket içinde benzersiz' })
  name!: string;

  @ApiPropertyOptional({ enum: WAREHOUSE_TYPES, default: 'WAREHOUSE' })
  type?: WarehouseType;

  @ApiPropertyOptional({ default: true, description: 'Depo silinmez; pasife almak için false' })
  isActive?: boolean;
}

// Swagger için sınıf karşılığı; alanlar packages/shared içindeki warehouseSchema ile aynı kalmak zorunda.
export class WarehouseDto implements Warehouse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Merkez Depo' })
  name!: string;

  @ApiProperty({ enum: WAREHOUSE_TYPES })
  type!: WarehouseType;

  @ApiProperty()
  isActive!: boolean;
}

@ApiTags('warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(
    @Inject(WarehousesRepository) private readonly warehouses: WarehousesRepository,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Post()
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Depo, şube ya da araç deposu ekler (yalnızca yönetici)' })
  @ApiBody({ type: WarehouseInputDto })
  @ApiCreatedResponse({ type: WarehouseDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Bu adla bir depo zaten var' })
  create(
    @CurrentOrganization() organization: OrganizationContext,
    @Body(new ZodValidationPipe(warehouseInputSchema)) body: WarehouseInput,
  ): Promise<WarehouseDto> {
    return this.inventory.createWarehouse(organization.id, body);
  }

  @Put(':warehouseId')
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Depoyu günceller ya da pasife alır (yalnızca yönetici; depo silinmez)' })
  @ApiBody({ type: WarehouseInputDto })
  @ApiOkResponse({ type: WarehouseDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Bu adla bir depo zaten var' })
  update(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body(new ZodValidationPipe(warehouseInputSchema)) body: WarehouseInput,
  ): Promise<WarehouseDto> {
    return this.inventory.updateWarehouse(organization.id, warehouseId, body);
  }

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
