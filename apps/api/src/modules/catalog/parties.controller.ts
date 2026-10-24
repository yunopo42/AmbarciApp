import { partyInputSchema, partyListQuerySchema } from '@ambarci/shared';
import type { PartyInput, PartyListQuery } from '@ambarci/shared';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { PartyDto, PartyInputDto, PartyListDto } from './catalog.dto.js';
import { PartiesService } from './parties.service.js';

/** Cariler (tedarikçi, müşteri). Borç-alacak tutulmaz. Okuma her üyeye, değiştirme yalnızca yöneticiye açık. */
@ApiTags('parties')
@ApiBearerAuth()
@Controller('parties')
export class PartiesController {
  constructor(@Inject(PartiesService) private readonly parties: PartiesService) {}

  @Get()
  @OrganizationScoped()
  @ApiOperation({ summary: 'Cariler; ad ya da vergi numarasında arama, türe göre süzme ve sayfalama' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false, enum: ['SUPPLIER', 'CUSTOMER'] })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: PartyListDto })
  list(
    @CurrentOrganization() organization: OrganizationContext,
    @Query(new ZodValidationPipe(partyListQuerySchema)) query: PartyListQuery,
  ): Promise<PartyListDto> {
    return this.parties.list(organization.id, query);
  }

  @Get(':partyId')
  @OrganizationScoped()
  @ApiOperation({ summary: 'Cari' })
  @ApiOkResponse({ type: PartyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('partyId', ParseUUIDPipe) partyId: string,
  ): Promise<PartyDto> {
    return this.parties.get(organization.id, partyId);
  }

  @Post()
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Cari ekler (yalnızca yönetici)' })
  @ApiBody({ type: PartyInputDto })
  @ApiCreatedResponse({ type: PartyDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Vergi numarası başka caride kullanılıyor' })
  create(
    @CurrentOrganization() organization: OrganizationContext,
    @Body(new ZodValidationPipe(partyInputSchema)) body: PartyInput,
  ): Promise<PartyDto> {
    return this.parties.create(organization.id, body);
  }

  @Put(':partyId')
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Cariyi günceller ya da pasife alır (yalnızca yönetici; silinmez)' })
  @ApiBody({ type: PartyInputDto })
  @ApiOkResponse({ type: PartyDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Vergi numarası başka caride kullanılıyor' })
  update(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('partyId', ParseUUIDPipe) partyId: string,
    @Body(new ZodValidationPipe(partyInputSchema)) body: PartyInput,
  ): Promise<PartyDto> {
    return this.parties.update(organization.id, partyId, body);
  }
}
