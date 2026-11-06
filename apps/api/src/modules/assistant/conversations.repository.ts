import { conversations, messages } from '@ambarci/db';
import type { DbExecutor, MessageContentBlock } from '@ambarci/db';
import type { Conversation, MessageStatus } from '@ambarci/shared';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';

import type { AgentMessage } from './agent-loop.js';

/** Saklanan bir mesaj, sohbetteki sırasıyla. */
export interface StoredMessage {
  id: string;
  position: number;
  role: AgentMessage['role'];
  content: MessageContentBlock[];
  clientMessageId: string | null;
  status: MessageStatus | null;
  createdAt: string;
}

/**
 * Sohbette bu kadar dakikadır hiçbir hareket yoksa süren görünen cevap yarıda kalmıştır (ör. sunucu yeniden başladı):
 * o mesaj başarısız sayılır ve tekrar gönderilebilir. Bir cevap turu sürerken her tur sohbeti "dokunur"; tek bir model
 * çağrısı yeniden denemelerle en fazla 3 dakika sürer (60 sn zaman aşımı, 2 yeniden deneme).
 */
export const STALE_TURN_MINUTES = 5;

const CONVERSATION_COLUMNS = {
  id: conversations.id,
  title: conversations.title,
  lastMessageAt: conversations.lastMessageAt,
  createdAt: conversations.createdAt,
};

const MESSAGE_COLUMNS = {
  id: messages.id,
  position: messages.position,
  role: messages.role,
  content: messages.content,
  clientMessageId: messages.clientMessageId,
  status: messages.status,
  createdAt: messages.createdAt,
};

type ConversationRow = { id: string; title: string | null; lastMessageAt: Date; createdAt: Date };
type MessageRow = Omit<StoredMessage, 'createdAt'> & { createdAt: Date };

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    lastMessageAt: row.lastMessageAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toStoredMessage(row: MessageRow): StoredMessage {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Sohbet ve mesaj sorguları; her sorgu şirket kimliğiyle, sohbet sorguları ayrıca sahibiyle sınırlanır (sohbeti
 * yalnızca sahibi görür). Mesajlar yalnızca eklenir; değişen tek alan kullanıcı mesajının durumudur.
 */
@Injectable()
export class ConversationsRepository {
  async create(executor: DbExecutor, organizationId: string, userId: string): Promise<Conversation> {
    const [row] = await executor.insert(conversations).values({ organizationId, userId }).returning(CONVERSATION_COLUMNS);
    if (!row) {
      throw new Error('Sohbet oluşturulamadı.');
    }
    return toConversation(row);
  }

  async list(
    executor: DbExecutor,
    organizationId: string,
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: Conversation[]; total: number }> {
    const where = and(eq(conversations.organizationId, organizationId), eq(conversations.userId, userId));
    const [totalRow] = await executor.select({ total: count() }).from(conversations).where(where);
    const rows = await executor
      .select(CONVERSATION_COLUMNS)
      .from(conversations)
      .where(where)
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: rows.map(toConversation), total: totalRow?.total ?? 0 };
  }

  async find(executor: DbExecutor, organizationId: string, userId: string, conversationId: string): Promise<Conversation | null> {
    const [row] = await executor
      .select(CONVERSATION_COLUMNS)
      .from(conversations)
      .where(
        and(eq(conversations.organizationId, organizationId), eq(conversations.userId, userId), eq(conversations.id, conversationId)),
      );
    return row ? toConversation(row) : null;
  }

  /**
   * Sohbet satırını transaction sonuna kadar kilitler (FOR UPDATE): aynı sohbete aynı anda gelen iki mesaj sırayla karar
   * verir. Sohbet yoksa ya da kullanıcının değilse null. `stale`: son hareketin üstünden STALE_TURN_MINUTES geçti.
   */
  async lockForTurn(tx: DbExecutor, organizationId: string, userId: string, conversationId: string): Promise<{ stale: boolean } | null> {
    const [row] = await tx.execute<{ stale: boolean }>(sql`
      select updated_at < now() - make_interval(mins => ${STALE_TURN_MINUTES}::int) as stale
      from ${conversations}
      where organization_id = ${organizationId} and user_id = ${userId} and id = ${conversationId}
      for update`);
    return row ?? null;
  }

  async listMessages(executor: DbExecutor, organizationId: string, conversationId: string): Promise<StoredMessage[]> {
    const rows = await executor
      .select(MESSAGE_COLUMNS)
      .from(messages)
      .where(and(eq(messages.organizationId, organizationId), eq(messages.conversationId, conversationId)))
      .orderBy(asc(messages.position));
    return rows.map(toStoredMessage);
  }

  async findByClientMessageId(
    executor: DbExecutor,
    organizationId: string,
    conversationId: string,
    clientMessageId: string,
  ): Promise<StoredMessage | null> {
    const [row] = await executor
      .select(MESSAGE_COLUMNS)
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.clientMessageId, clientMessageId),
        ),
      );
    return row ? toStoredMessage(row) : null;
  }

  /** Sohbette cevabı süren bir kullanıcı mesajı var mı? */
  async hasTurnInProgress(executor: DbExecutor, organizationId: string, conversationId: string): Promise<boolean> {
    const [row] = await executor
      .select({ one: sql<number>`1` })
      .from(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.status, 'IN_PROGRESS'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Yarıda kalmış cevapları başarısız yapar (sohbet STALE_TURN_MINUTES'tır hareketsizse çağrılır). */
  async failTurnsInProgress(executor: DbExecutor, organizationId: string, conversationId: string): Promise<void> {
    await executor
      .update(messages)
      .set({ status: 'FAILED' })
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.status, 'IN_PROGRESS'),
        ),
      );
  }

  /** Kullanıcı mesajını sohbetin sonuna ekler; sıra numarası aynı ifadede hesaplanır. */
  async insertUserMessage(
    executor: DbExecutor,
    input: { organizationId: string; conversationId: string; userId: string; text: string; clientMessageId: string },
  ): Promise<StoredMessage> {
    const content: MessageContentBlock[] = [{ type: 'text', text: input.text }];
    const [row] = await executor.execute<Omit<StoredMessage, 'content'> & { content: MessageContentBlock[] }>(sql`
      insert into ${messages} (organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
      select ${input.organizationId}, ${input.conversationId}, ${input.userId}, coalesce(max(position), 0) + 1, 'USER',
             ${JSON.stringify(content)}::jsonb, ${input.clientMessageId}, 'IN_PROGRESS'
      from ${messages}
      where organization_id = ${input.organizationId} and conversation_id = ${input.conversationId}
      returning id, position, role, content, client_message_id as "clientMessageId", status,
                to_json(created_at) #>> '{}' as "createdAt"`);
    if (!row) {
      throw new Error('Mesaj yazılamadı.');
    }
    return { ...row, createdAt: new Date(row.createdAt).toISOString() };
  }

  /**
   * Bir cevap turunun mesajlarını (ASSISTANT, TOOL) sırayla sona ekler ve sohbeti "dokunur" (updated_at): sohbet süren
   * cevap boyunca hareketli görünür. Tek ifade: mesajların hepsi yazılır ya da hiçbiri yazılmaz.
   */
  async appendMessages(
    executor: DbExecutor,
    input: { organizationId: string; conversationId: string; userId: string; messages: AgentMessage[] },
  ): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    const rows = sql.join(
      input.messages.map((message, index) => sql`(${index + 1}::int, ${message.role}::message_role, ${JSON.stringify(message.content)}::jsonb)`),
      sql`, `,
    );
    await executor.execute(sql`
      with base as (
        select coalesce(max(position), 0) as position
        from ${messages}
        where organization_id = ${input.organizationId} and conversation_id = ${input.conversationId}
      ),
      inserted as (
        insert into ${messages} (organization_id, conversation_id, user_id, position, role, content)
        select ${input.organizationId}, ${input.conversationId}, ${input.userId}, base.position + added.ord, added.role, added.content
        from base, (values ${rows}) as added(ord, role, content)
        returning 1
      )
      update ${conversations} set updated_at = now()
      where organization_id = ${input.organizationId} and id = ${input.conversationId}`);
  }

  /** Kullanıcı mesajının durumunu değiştirir ve sohbetin son hareket zamanlarını günceller; başlık yoksa verilir. */
  async setTurnStatus(
    executor: DbExecutor,
    input: { organizationId: string; conversationId: string; messageId: string; status: MessageStatus; title?: string },
  ): Promise<void> {
    await executor.execute(sql`
      with changed as (
        update ${messages} set status = ${input.status}::message_status
        where organization_id = ${input.organizationId} and id = ${input.messageId} and role = 'USER'
        returning 1
      )
      update ${conversations}
      set updated_at = now(), last_message_at = now(), title = coalesce(title, ${input.title ?? null}::text)
      where organization_id = ${input.organizationId} and id = ${input.conversationId}`);
  }
}
