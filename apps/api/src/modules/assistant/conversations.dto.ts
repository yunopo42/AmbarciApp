import type { ChatMessage, ChatMessageList, Conversation, ConversationList, MessageStatus, SendMessageInput } from '@ambarci/shared';
import { MESSAGE_TEXT_MAX_LENGTH } from '@ambarci/shared';
import { ApiProperty } from '@nestjs/swagger';

// Swagger için sınıf karşılıkları; alanlar packages/shared/src/conversations.ts içindeki şemalarla aynı kalmak zorunda.

export class ConversationDto implements Conversation {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, example: 'Merkez depoda NYM 3x2,5 kablo kaç metre?' })
  title!: string | null;

  @ApiProperty({ format: 'date-time' })
  lastMessageAt!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ConversationListDto implements ConversationList {
  @ApiProperty({ type: [ConversationDto] })
  items!: ConversationDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

const MESSAGE_STATUSES: MessageStatus[] = ['IN_PROGRESS', 'COMPLETED', 'FAILED'];

export class ChatMessageDto implements ChatMessage {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty({ example: 'Merkez Depo’da 1.400 metre var.' })
  text!: string;

  @ApiProperty({ enum: MESSAGE_STATUSES, nullable: true, description: 'Yalnızca kullanıcı mesajında: cevabın durumu' })
  status!: MessageStatus | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Yalnızca kullanıcı mesajında' })
  clientMessageId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ChatMessageListDto implements ChatMessageList {
  @ApiProperty({ type: [ChatMessageDto] })
  items!: ChatMessageDto[];
}

export class SendMessageDto implements SendMessageInput {
  @ApiProperty({ format: 'uuid', description: 'İstemcinin mesaj için ürettiği kimlik; tekrar denemede aynısı gönderilir' })
  clientMessageId!: string;

  @ApiProperty({ minLength: 1, maxLength: MESSAGE_TEXT_MAX_LENGTH, example: 'Merkez depoda NYM 3x2,5 kablodan kaç metre kaldı?' })
  text!: string;
}
