import { conversationListQuerySchema, sendMessageSchema } from '@ambarci/shared';
import type { AuthUser, ConversationListQuery, SendMessageInput } from '@ambarci/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { CurrentOrganization, OrganizationScoped } from '../organizations/organization.decorators.js';
import { ChatMessageListDto, ConversationDto, ConversationListDto, SendMessageDto } from './conversations.dto.js';
import { ConversationsService } from './conversations.service.js';
import { SseStream } from './sse-stream.js';

const STREAM_DESCRIPTION = [
  'Server-Sent Events (text/event-stream). Her olay `event: <tür>` ve JSON `data:` satırıdır; şema packages/shared',
  'içindeki chatStreamEventSchema. Sıra: message_started, ardından text_delta ve tool_status olayları, en sonda done ya',
  'da error. Aradaki `: ping` satırları yalnızca bağlantıyı canlı tutar.',
].join(' ');

/**
 * Asistanla sohbet. Sohbeti ve mesajlarını yalnızca sahibi görür; başka kullanıcının ya da başka şirketin sohbeti
 * bulunamadı (404) döner. Asistan stoğa yazmaz; stok yalnızca işlem onayıyla değişir.
 */
@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(@Inject(ConversationsService) private readonly conversations: ConversationsService) {}

  @Post()
  @OrganizationScoped()
  @ApiOperation({ summary: 'Yeni sohbet açar' })
  @ApiCreatedResponse({ type: ConversationDto })
  create(@CurrentUser() user: AuthUser, @CurrentOrganization() organization: OrganizationContext): Promise<ConversationDto> {
    return this.conversations.create(organization, user.id);
  }

  @Get()
  @OrganizationScoped()
  @ApiOperation({ summary: 'Kullanıcının aktif şirketteki sohbetleri, en son konuşulan önce' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: 'En fazla 100' })
  @ApiOkResponse({ type: ConversationListDto })
  list(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Query(new ZodValidationPipe(conversationListQuerySchema)) query: ConversationListQuery,
  ): Promise<ConversationListDto> {
    return this.conversations.list(organization, user.id, query);
  }

  @Get(':conversationId/messages')
  @OrganizationScoped()
  @ApiOperation({ summary: 'Sohbetin mesajları, sırasıyla: kullanıcının yazdıkları ve asistanın metin cevapları' })
  @ApiOkResponse({ type: ChatMessageListDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  messages(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<ChatMessageListDto> {
    return this.conversations.messages(organization, user.id, conversationId);
  }

  @Post(':conversationId/messages')
  @OrganizationScoped()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mesaj gönderir ve cevabı akıtır (SSE). Aynı clientMessageId tekrar gelirse cevap tamamlanmışsa kayıtlı cevap döner, model çağrılmaz',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: STREAM_DESCRIPTION, schema: { type: 'string' } })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Bu mesajın ya da sohbetteki başka bir mesajın cevabı hâlâ hazırlanıyor' })
  async send(
    @CurrentUser() user: AuthUser,
    @CurrentOrganization() organization: OrganizationContext,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @Res() response: Response,
  ): Promise<void> {
    await this.conversations.send(organization, user.id, conversationId, body, new SseStream(response));
  }
}
