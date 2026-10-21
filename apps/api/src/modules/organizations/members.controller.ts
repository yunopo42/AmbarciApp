import { Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import type { OrganizationContext } from './organization-context.js';
import { CurrentOrganization, OrganizationScoped } from './organization.decorators.js';
import { MemberDto } from './organizations.dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('members')
@ApiBearerAuth()
@Controller('members')
@OrganizationScoped({ roles: ['ADMIN'] })
export class MembersController {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Aktif şirketin üyeleri, rolleri ve depo yetkileri (yalnızca yönetici)' })
  @ApiOkResponse({ type: [MemberDto] })
  list(@CurrentOrganization() organization: OrganizationContext): Promise<MemberDto[]> {
    return this.organizations.listMembers(organization.id);
  }

  @Put(':memberId/warehouses/:warehouseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Çalışana depoda işlem yetkisi verir (yalnızca yönetici)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Üye ya da depo bu şirkette yok' })
  grant(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
  ): Promise<void> {
    return this.organizations.grantWarehouseAccess(organization.id, memberId, warehouseId);
  }

  @Delete(':memberId/warehouses/:warehouseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Çalışanın depo yetkisini kaldırır (yalnızca yönetici)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Bu üyenin bu depoda yetkisi yok' })
  revoke(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
  ): Promise<void> {
    return this.organizations.revokeWarehouseAccess(organization.id, memberId, warehouseId);
  }
}
