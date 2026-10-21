import { createOrganizationSchema } from '@ambarci/shared';
import type { AuthUser, CreateOrganizationInput } from '@ambarci/shared';
import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreateOrganizationDto, OrganizationMembershipDto } from './organizations.dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}

  @Post()
  @ApiOperation({ summary: 'Şirket oluşturur; oluşturan kullanıcı şirketin yöneticisi (ADMIN) olur' })
  @ApiBody({ type: CreateOrganizationDto })
  @ApiCreatedResponse({ type: OrganizationMembershipDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationInput,
  ): Promise<OrganizationMembershipDto> {
    return this.organizations.createOrganization(body.name, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Kullanıcının aktif üyesi olduğu şirketler ve rolleri' })
  @ApiOkResponse({ type: [OrganizationMembershipDto] })
  list(@CurrentUser() user: AuthUser): Promise<OrganizationMembershipDto[]> {
    return this.organizations.listMyOrganizations(user.id);
  }
}
