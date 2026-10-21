import { acceptInvitationSchema, createInvitationSchema } from '@ambarci/shared';
import type { AcceptInvitationInput, AuthUser, CreateInvitationInput } from '@ambarci/shared';
import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { OrganizationContext } from './organization-context.js';
import { CurrentOrganization, OrganizationScoped } from './organization.decorators.js';
import { AcceptInvitationDto, CreateInvitationDto, InvitationDto, OrganizationMembershipDto } from './organizations.dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService) {}

  @Post()
  @OrganizationScoped({ roles: ['ADMIN'] })
  @ApiOperation({ summary: 'Aktif şirket için tek kullanımlık, süreli davet kodu üretir (yalnızca yönetici)' })
  @ApiBody({ type: CreateInvitationDto })
  @ApiCreatedResponse({ type: InvitationDto })
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationInput,
  ): Promise<InvitationDto> {
    return this.organizations.createInvitation({
      organizationId: organization.id,
      role: body.role,
      expiresInDays: body.expiresInDays,
      createdBy: user.id,
    });
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Davet koduyla şirkete katılır; kod bir kez kullanılabilir' })
  @ApiBody({ type: AcceptInvitationDto })
  @ApiOkResponse({ type: OrganizationMembershipDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Kod bulunamadı' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Kod kullanılmış ya da zaten üyesiniz' })
  @ApiGoneResponse({ type: ApiErrorDto, description: 'Kodun süresi dolmuş' })
  accept(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
  ): Promise<OrganizationMembershipDto> {
    return this.organizations.acceptInvitation(body.code, user.id);
  }
}
