import type { Database, MessageContentBlock } from '@ambarci/db';
import type {
  ChatMessage,
  ChatMessageList,
  ChatStreamEvent,
  Conversation,
  ConversationList,
  ConversationListQuery,
  SendMessageInput,
} from '@ambarci/shared';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../../common/api-exception.js';
import { postgresErrorOf } from '../../common/postgres-error.js';
import { DATABASE } from '../../database/database.module.js';
import { AiService } from '../ai/ai.service.js';
import type { OrganizationContext } from '../organizations/organization-context.js';
import { AgentLoop } from './agent-loop.js';
import { ConversationsRepository } from './conversations.repository.js';
import type { StoredMessage } from './conversations.repository.js';

/** Cevabın aktığı yer (SSE). open() çağrılana kadar istemciye hiçbir şey yazılmaz; hata JSON olarak dönebilir. */
export interface ChatStreamSink {
  open(): void;
  send(event: ChatStreamEvent): void;
  close(): void;
}

type Turn = { kind: 'replay'; message: StoredMessage; text: string } | { kind: 'started'; message: StoredMessage };

const TITLE_MAX_LENGTH = 80;

/** İlk mesajdan sohbet başlığı: boşluklar sadeleşir, uzunsa kısaltılır. */
export function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= TITLE_MAX_LENGTH ? flat : `${flat.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

function textOf(content: MessageContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

/** Ekranda gösterilen mesajlar: kullanıcının yazdıkları ve asistanın metinleri. Araç sonuçları ve düşünme gösterilmez. */
export function toChatMessages(stored: StoredMessage[]): ChatMessage[] {
  return stored.flatMap((message): ChatMessage[] => {
    if (message.role === 'TOOL') {
      return [];
    }
    const text = textOf(message.content);
    if (message.role === 'ASSISTANT' && text === '') {
      // Yalnızca araç çağrısı içeren model mesajı.
      return [];
    }
    return [
      {
        id: message.id,
        role: message.role === 'USER' ? 'user' : 'assistant',
        text,
        status: message.status,
        clientMessageId: message.clientMessageId,
        createdAt: message.createdAt,
      },
    ];
  });
}

/** Kullanıcı mesajının kayıtlı cevabı: o mesajdan sonraki, sıradaki kullanıcı mesajından önceki son asistan metni. */
export function answerTo(stored: StoredMessage[], userMessage: StoredMessage): string {
  const after = stored.filter((message) => message.position > userMessage.position);
  const nextUser = after.findIndex((message) => message.role === 'USER');
  const turn = nextUser === -1 ? after : after.slice(0, nextUser);
  const answer = turn.filter((message) => message.role === 'ASSISTANT' && textOf(message.content) !== '').at(-1);
  return answer ? textOf(answer.content) : '';
}

/**
 * Asistanla sohbet: sohbet açma ve listeleme, mesajlar, mesaj gönderme ve cevabın akışı. Model akarken açık transaction
 * ya da tutulan veritabanı bağlantısı yoktur (Supabase oturum havuzu 15 istemci): veritabanına yalnızca cevap
 * başlarken (kısa bir transaction), her tur bitince ve en sonda kısa sorgularla gidilir.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConversationsRepository) private readonly repository: ConversationsRepository,
    @Inject(AgentLoop) private readonly agent: AgentLoop,
    @Inject(AiService) private readonly ai: AiService,
  ) {}

  create(organization: OrganizationContext, userId: string): Promise<Conversation> {
    return this.repository.create(this.db, organization.id, userId);
  }

  async list(organization: OrganizationContext, userId: string, query: ConversationListQuery): Promise<ConversationList> {
    const { items, total } = await this.repository.list(this.db, organization.id, userId, query.page, query.pageSize);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async messages(organization: OrganizationContext, userId: string, conversationId: string): Promise<ChatMessageList> {
    await this.findOwned(organization.id, userId, conversationId);
    return { items: toChatMessages(await this.repository.listMessages(this.db, organization.id, conversationId)) };
  }

  /**
   * Mesajı kaydeder ve cevabı akıtır. Aynı clientMessageId tekrar gelirse: cevap tamamlanmışsa kayıtlı cevap döner
   * (model çağrılmaz), sürüyorsa 409, başarısız olduysa aynı mesaj için cevap yeniden üretilir. Sohbette başka bir
   * cevap sürerken yeni mesaj 409 alır. Bu kararlar akış açılmadan verilir; hata JSON olarak döner.
   *
   * İstemci bağlantıyı kapatsa da cevap tamamlanıp kaydedilir: aynı kimlikle tekrar geldiğinde kayıtlı cevabı alır.
   */
  async send(
    organization: OrganizationContext,
    userId: string,
    conversationId: string,
    input: SendMessageInput,
    sink: ChatStreamSink,
  ): Promise<void> {
    const turn = await this.startTurn(organization.id, userId, conversationId, input);
    const { message } = turn;
    sink.open();
    try {
      sink.send({ type: 'message_started', messageId: message.id, clientMessageId: input.clientMessageId });
      if (turn.kind === 'replay') {
        if (turn.text !== '') {
          sink.send({ type: 'text_delta', text: turn.text });
        }
        sink.send({ type: 'done', messageId: message.id, text: turn.text, replayed: true });
        return;
      }

      const history = await this.repository.listMessages(this.db, organization.id, conversationId);
      const promptVersion = await this.ai.conversationPromptVersion(
        organization.id,
        history.filter((stored) => stored.role === 'USER').map((stored) => stored.id),
      );
      const output = await this.agent.run({
        context: { organization, userId },
        messageId: message.id,
        promptVersion,
        history: history.map(({ role, content }) => ({ role, content })),
        onEvent: (event) => sink.send(event),
        onRound: (added) =>
          this.repository.appendMessages(this.db, { organizationId: organization.id, conversationId, userId, messages: added }),
      });
      await this.repository.setTurnStatus(this.db, {
        organizationId: organization.id,
        conversationId,
        messageId: message.id,
        status: 'COMPLETED',
      });
      sink.send({ type: 'done', messageId: message.id, text: output.text, replayed: false });
    } catch (error) {
      if (turn.kind === 'started') {
        await this.repository
          .setTurnStatus(this.db, { organizationId: organization.id, conversationId, messageId: message.id, status: 'FAILED' })
          .catch((statusError: unknown) => this.logger.error(`Mesaj durumu yazılamadı: ${String(statusError)}`));
      }
      sink.send({ type: 'error', ...this.streamError(error) });
    } finally {
      sink.close();
    }
  }

  /**
   * Cevabın başlangıcı, tek kısa transaction'da: sohbet kilitlenir, tekrar gelen mesaj tanınır, yeni mesaj yazılır.
   * Model bu transaction'ın dışında çağrılır.
   */
  private async startTurn(organizationId: string, userId: string, conversationId: string, input: SendMessageInput): Promise<Turn> {
    try {
      return await this.db.transaction(async (tx): Promise<Turn> => {
        const lock = await this.repository.lockForTurn(tx, organizationId, userId, conversationId);
        if (!lock) {
          throw notFound();
        }
        if (lock.stale) {
          // Sohbet uzun süredir hareketsiz: süren görünen cevap yarıda kalmıştır (ör. sunucu yeniden başladı).
          await this.repository.failTurnsInProgress(tx, organizationId, conversationId);
        }

        const existing = await this.repository.findByClientMessageId(tx, organizationId, conversationId, input.clientMessageId);
        if (existing?.status === 'COMPLETED') {
          const stored = await this.repository.listMessages(tx, organizationId, conversationId);
          return { kind: 'replay', message: existing, text: answerTo(stored, existing) };
        }
        if (existing?.status === 'IN_PROGRESS') {
          throw new ApiException(HttpStatus.CONFLICT, 'MESSAGE_IN_PROGRESS', 'Bu mesajın cevabı hâlâ hazırlanıyor.');
        }
        if (await this.repository.hasTurnInProgress(tx, organizationId, conversationId)) {
          throw busy();
        }

        if (existing) {
          // Başarısız olmuş mesaj: yeni kayıt açılmaz, aynı mesajın cevabı yeniden üretilir.
          await this.repository.setTurnStatus(tx, { organizationId, conversationId, messageId: existing.id, status: 'IN_PROGRESS' });
          return { kind: 'started', message: { ...existing, status: 'IN_PROGRESS' } };
        }
        const message = await this.repository.insertUserMessage(tx, {
          organizationId,
          conversationId,
          userId,
          text: input.text,
          clientMessageId: input.clientMessageId,
        });
        await this.repository.setTurnStatus(tx, {
          organizationId,
          conversationId,
          messageId: message.id,
          status: 'IN_PROGRESS',
          title: titleFrom(input.text),
        });
        return { kind: 'started', message };
      });
    } catch (error) {
      // Kilit yarışı önler; benzersizlik kısıtı yine de ihlal edilirse (sıra ya da istemci kimliği) sohbet meşguldür.
      if (postgresErrorOf(error).code === '23505') {
        throw busy();
      }
      throw error;
    }
  }

  private async findOwned(organizationId: string, userId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.repository.find(this.db, organizationId, userId, conversationId);
    if (!conversation) {
      throw notFound();
    }
    return conversation;
  }

  /** Akış açıldıktan sonraki hata: bilinen hata kodu ve Türkçe mesajıyla; beklenmeyen hata yalnızca loga. */
  private streamError(error: unknown): { code: string; message: string } {
    if (error instanceof ApiException) {
      return { code: error.code, message: error.message };
    }
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return { code: 'INTERNAL_ERROR', message: 'Beklenmeyen bir hata oluştu.' };
  }
}

function notFound(): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'CONVERSATION_NOT_FOUND', 'Sohbet bulunamadı.');
}

function busy(): ApiException {
  return new ApiException(HttpStatus.CONFLICT, 'CONVERSATION_BUSY', 'Bu sohbette bir cevap hâlâ hazırlanıyor; bitmesini bekleyin.');
}
