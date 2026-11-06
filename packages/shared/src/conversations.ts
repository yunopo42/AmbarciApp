import { z } from 'zod';

import { pageQuery } from './catalog.js';

// Asistanla sohbet: sohbetler, ekranda gösterilen mesajlar, mesaj gönderme ve cevabın akışı (SSE). Mobil ve web aynı
// şemaları kullanır. Araç sonuçları ve modelin düşünme blokları sunucuda saklanır ama istemciye gönderilmez.

const timestamp = z.iso.datetime({ offset: true });

export const conversationSchema = z.object({
  id: z.uuid(),
  /** İlk mesajdan üretilen kısa başlık; henüz mesaj yoksa null. */
  title: z.string().nullable(),
  lastMessageAt: timestamp,
  createdAt: timestamp,
});
export type Conversation = z.infer<typeof conversationSchema>;

/** GET /v1/conversations: kullanıcının aktif şirketteki sohbetleri, en son konuşulan önce. */
export const conversationListQuerySchema = z.object({ ...pageQuery });
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

/** Kullanıcı mesajının cevap durumu. */
export const messageStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED']);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

/** Sohbet ekranında gösterilen mesaj: kullanıcının yazdığı ya da asistanın metin cevabı. */
export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** Yalnızca kullanıcı mesajında: cevap sürüyor, tamamlandı ya da başarısız oldu. */
  status: messageStatusSchema.nullable(),
  /** Yalnızca kullanıcı mesajında: istemcinin ürettiği kimlik. */
  clientMessageId: z.uuid().nullable(),
  createdAt: timestamp,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatMessageListSchema = z.object({ items: z.array(chatMessageSchema) });
export type ChatMessageList = z.infer<typeof chatMessageListSchema>;

export const MESSAGE_TEXT_MAX_LENGTH = 2000;

/**
 * POST /v1/conversations/{id}/messages. İstemci her mesaj için bir kimlik (UUID) üretir ve ağ hatasında aynı kimlikle
 * tekrar gönderir: cevap tamamlanmışsa kayıtlı cevap döner, model ikinci kez çağrılmaz.
 */
export const sendMessageSchema = z.object({
  clientMessageId: z.uuid(),
  text: z
    .string()
    .trim()
    .min(1, 'Mesaj boş olamaz.')
    .max(MESSAGE_TEXT_MAX_LENGTH, `Mesaj en fazla ${MESSAGE_TEXT_MAX_LENGTH} karakter olabilir.`),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * Cevabın akışındaki olaylar. Her olay SSE biçiminde gelir: `event: <type>` satırı ve JSON `data:` satırı. Arada gelen
 * `: ping` satırları yalnızca bağlantıyı canlı tutar, olay değildir. Akış her zaman `done` ya da `error` ile biter.
 */
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  /** Mesaj kaydedildi (ya da daha önce kaydedilmişti); cevap başlıyor. */
  z.object({ type: z.literal('message_started'), messageId: z.uuid(), clientMessageId: z.uuid() }),
  /** Cevabın bir metin parçası; parçalar art arda eklenir. */
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  /** Asistan bir araç çalıştırıyor ya da çalıştırdı (ör. "Ürün aranıyor"). */
  z.object({
    type: z.literal('tool_status'),
    tool: z.string(),
    label: z.string(),
    status: z.enum(['started', 'succeeded', 'failed']),
  }),
  /** Cevap bitti. `text` cevabın tamamı; `replayed` true ise cevap daha önce üretilmişti, model çağrılmadı. */
  z.object({ type: z.literal('done'), messageId: z.uuid(), text: z.string(), replayed: z.boolean() }),
  /** Cevap üretilemedi; kullanıcı mesajı başarısız olarak kalır, aynı kimlikle tekrar gönderilebilir. */
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
