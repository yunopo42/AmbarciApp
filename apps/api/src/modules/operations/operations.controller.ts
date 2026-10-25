import {
  confirmOperationSchema,
  createOperationSchema,
  IDEMPOTENCY_HEADER,
  idempotencyKeySchema,
  operationListQuerySchema,
} from '@ambarci/shared';
import type { AuthUser, ConfirmOperationInput, CreateOperationInput, OperationListQuery } from '@ambarci/shared';
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ApiException } from '../../common/api-exception.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import {
  ConfirmOperationDto,
  ConfirmOperationResultDto,
  CreateOperationDto,
  OperationDto,
  OperationListDto,
  OperationPreviewDto,
  STATUSES,
} from './operations.dto.js';
import { OperationsService } from './operations.service.js';
import type { OperationActor } from './operations.service.js';

/**
 * Stok işlemleri. Stok yalnızca /confirm ile değişir (mimari değişmez 2); bu uç nokta asistan modülünden
 * çağrılmaz. Ekrandan açılan işlem de önce onay bekler.
 */
@ApiTags('operations')
@ApiBearerAuth()
@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Post()
  @OrganizationScoped()
  @ApiOperation({ summary: 'Stok işlemi açar (giriş, çıkış, transfer, sayım, fire, açılış); onay bekler, stok değişmez' })
  @ApiBody({ type: CreateOperationDto })
  @ApiCreatedResponse({ type: OperationDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'Kalemlerde ürün, birim ya da depo geçersiz' })
  create(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Body(new ZodValidationPipe(createOperationSchema)) body: CreateOperationInput,
  ): Promise<OperationDto> {
    return this.operations.create(organization.id, actorOf(user, organization), body);
  }

  @Get()
  @OrganizationScoped()
  @ApiOperation({
    summary:
      'İşlemler, en yeni önce; varsayılan yalnızca onay bekleyenler. Çalışan yalnızca bütün depolarında yetkili olduğu işlemleri görür',
  })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES, description: 'Varsayılan PENDING_CONFIRMATION' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: OperationListDto })
  list(
    @CurrentOrganization() organization: OrganizationContext,
    @Query(new ZodValidationPipe(operationListQuerySchema)) query: OperationListQuery,
  ): Promise<OperationListDto> {
    return this.operations.list(organization, query);
  }

  @Get(':operationId')
  @OrganizationScoped()
  @ApiOperation({ summary: 'İşlem ve kalemleri' })
  @ApiOkResponse({ type: OperationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  get(
    @CurrentOrganization() organization: OrganizationContext,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<OperationDto> {
    return this.operations.get(organization.id, operationId);
  }

  @Get(':operationId/preview')
  @OrganizationScoped()
  @ApiOperation({
    summary:
      'Onay ekranının özeti: kalemler, ana birim karşılıkları ve stoğun önce → sonra hâli (sunucuda hesaplanır; stok değişmez)',
  })
  @ApiOkResponse({ type: OperationPreviewDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  preview(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<OperationPreviewDto> {
    return this.operations.preview(organization.id, actorOf(user, organization), operationId);
  }

  @Post(':operationId/confirm')
  @OrganizationScoped()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "İşlemi onaylar ve stoğu tek transaction'da değiştirir; aynı Idempotency-Key ile tekrar gelen istek aynı cevabı alır",
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Her onay denemesi için istemcinin ürettiği anahtar (UUID önerilir)' })
  @ApiBody({ type: ConfirmOperationDto })
  @ApiOkResponse({
    type: ConfirmOperationResultDto,
    headers: {
      'Server-Timing': {
        description: "Onay transaction'ının sunucudaki süresi, ör. db;dur=182.4 (ms)",
        schema: { type: 'string' },
      },
    },
  })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: 'Stok yetersiz, işlem onay beklemiyor, sürüm değişmiş ya da anahtar başka işlemde kullanılmış',
  })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto, description: 'Kalemlerde ürün, birim ya da depo artık geçersiz' })
  confirm(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(confirmOperationSchema)) body: ConfirmOperationInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ConfirmOperationResultDto> {
    const key = parseIdempotencyKey(idempotencyKey);
    const started = performance.now();
    return this.operations.confirm(organization.id, actorOf(user, organization), operationId, body, key).finally(() => {
      // Onay transaction'ının sunucudaki süresi (BEGIN'den COMMIT'e; hata cevabında da). İstemci ağ gecikmesini
      // bundan ayırabilir; bölgeler arası gecikme ölçümü (#34) bu başlığı okur.
      response.setHeader('Server-Timing', `db;dur=${(performance.now() - started).toFixed(1)};desc="onay transaction"`);
    });
  }

  @Post(':operationId/cancel')
  @OrganizationScoped()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Onay bekleyen işlemi iptal eder (işlemi açan kişi ya da yönetici)' })
  @ApiOkResponse({ type: OperationDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'İşlem onay beklemiyor' })
  cancel(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<OperationDto> {
    return this.operations.cancel(organization.id, actorOf(user, organization), operationId);
  }
}

function actorOf(user: AuthUser, organization: OrganizationContext): OperationActor {
  return { kind: 'user', userId: user.id, role: organization.role };
}

function parseIdempotencyKey(value: string | undefined): string {
  if (!value) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key başlığı zorunlu.');
  }
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key geçersiz.');
  }
  return result.data;
}
