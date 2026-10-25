import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import { conversationChannel, createdAtOnly, messageRole, messageStatus, timestamps } from './common.ts';
import { organizations } from './organizations.ts';
import { adminCanRead, ownerCanRead } from './rls.ts';

/** Claude API'nin içerik bloğu (text, thinking, tool_use, tool_result…). Biçimini ai modülü doğrular. */
export type MessageContentBlock = Record<string, unknown>;

/**
 * Asistanla sohbet. Her sohbet tek bir kullanıcınındır; mesajlarını yalnızca o okur. Hesap silinince (KVKK)
 * sohbet ve mesajları da silinir: içerik kişinin kendi yazdıklarıdır. Model çağrısı kayıtları (ai_runs) kalır.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    channel: conversationChannel('channel').notNull().default('APP'),
    // İlk mesajdan API'nin ürettiği kısa başlık; sohbet listesinde görünür.
    title: text('title'),
    // Sohbet listesi bu alana göre sıralanır (en son konuşulan önce).
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    // Mesajların bileşik yabancı anahtarının hedefi: mesaj aynı şirketin ve aynı kullanıcının sohbetine bağlanır.
    unique('conversations_org_id_user_key').on(t.organizationId, t.id, t.userId),
    // "Sohbetlerim" listesi; kullanıcı kolonuyla başladığı için hesap silinirken de kullanılır.
    index('conversations_user_org_last_message_idx').on(t.userId, t.organizationId, t.lastMessageAt),
    check('conversations_title_length', sql`char_length(${t.title}) between 1 and 200`),
    ownerCanRead('conversations', t.organizationId, t.userId),
  ],
).enableRLS();

/**
 * Sohbetin mesajları. İçerik, Claude API'nin döndürdüğü bloklarla (düşünme blokları dahil) değiştirilmeden saklanır;
 * modele gönderilen geçmiş bu tablodan sıra numarasıyla birebir kurulur. Geçmiş yalnızca sona eklenerek büyür
 * (ADR-001): yazılmış bir mesajın içeriği değişmez, yalnızca kullanıcı mesajının durumu güncellenir.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    // Sohbetin sahibi. RLS bu kolona bakar; bileşik yabancı anahtar sohbetin sahibiyle aynı olmasını garanti eder.
    userId: uuid('user_id').notNull(),
    // Sohbetteki sıra (1, 2, 3…). Aynı sıraya iki mesaj yazılamaz: aynı sohbette aynı anda iki cevap üretilmeye
    // çalışılırsa ikincisi burada reddedilir ve geçmiş karışmaz.
    position: integer('position').notNull(),
    role: messageRole('role').notNull(),
    content: jsonb('content').$type<MessageContentBlock[]>().notNull(),
    // Yalnızca kullanıcı mesajında: istemcinin ürettiği kimlik. Ağ hatasında aynı kimlikle tekrar gönderilir.
    clientMessageId: uuid('client_message_id'),
    // Yalnızca kullanıcı mesajında: cevabın durumu.
    status: messageStatus('status'),
    ...createdAtOnly,
  },
  (t) => [
    foreignKey({
      name: 'messages_conversation_fk',
      columns: [t.organizationId, t.conversationId, t.userId],
      foreignColumns: [conversations.organizationId, conversations.id, conversations.userId],
    }).onDelete('cascade'),
    // Model çağrısı kayıtlarının (ai_runs) bileşik yabancı anahtarının hedefi.
    unique('messages_org_id_key').on(t.organizationId, t.id),
    // Geçmiş bu sırayla okunur.
    unique('messages_org_conversation_position_key').on(t.organizationId, t.conversationId, t.position),
    // Aynı mesaj iki kez işlenmez. Kullanıcı mesajı dışındakilerde kolon boştur; boş değerler kısıta takılmaz.
    unique('messages_org_conversation_client_message_key').on(t.organizationId, t.conversationId, t.clientMessageId),
    // Yabancı anahtar indeksi (sohbet silinince mesajları bulmak için).
    index('messages_conversation_fk_idx').on(t.organizationId, t.conversationId, t.userId),
    check('messages_position_positive', sql`${t.position} >= 1`),
    // İçerik boş olmayan bir blok dizisidir. Claude API boş içerikli mesajı reddettiği için boş mesaj
    // yazılırsa sohbetin sonraki bütün istekleri bozulurdu.
    // CASE: jsonb_array_length dizi olmayan değerde hata verir; önce türe bakılır.
    check(
      'messages_content_blocks',
      sql`case when jsonb_typeof(${t.content}) = 'array' then jsonb_array_length(${t.content}) > 0 else false end`,
    ),
    // İstemci kimliği ve durum yalnızca kullanıcı mesajında bulunur ve orada zorunludur.
    check('messages_client_message_id_user', sql`(${t.role} = 'USER') = (${t.clientMessageId} is not null)`),
    check('messages_status_user', sql`(${t.role} = 'USER') = (${t.status} is not null)`),
    ownerCanRead('messages', t.organizationId, t.userId),
  ],
).enableRLS();

/**
 * Her model çağrısının kaydı: maliyet, süre ve değerlendirme kaynağı (mimari değişmez 10). Bir kullanıcı mesajının
 * cevabı birden fazla çağrı sürebilir (araç turları); hepsi aynı mesaja bağlanır ve tur numarası taşır. Günlük
 * token bütçesi bu tablodan hesaplanır. Mesaj içeriği burada tutulmaz.
 *
 * Kişisel veri içermediği için hesap ya da sohbet silinince kayıt kalır, yalnızca kişi ve mesaj bağlantısı boşalır.
 */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    // Çağrıyı başlatan kullanıcı mesajı.
    messageId: uuid('message_id'),
    // Aynı mesajın cevabındaki kaçıncı model çağrısı (1: ilk çağrı; her araç turu bir sonrakini başlatır).
    roundNo: smallint('round_no').notNull(),
    model: text('model').notNull(),
    // Sistem promptunun sürümü (ai/prompts). Prompt değişince artar; sonuçlar sürüme göre kıyaslanır.
    promptVersion: text('prompt_version').notNull(),
    // Düşünme düzeyi (low, medium…); desteklemeyen modelde boş.
    effort: text('effort'),
    // Bu çağrıda modelin istediği araçlar, sırasıyla.
    toolCalls: text('tool_calls').array().notNull().default(sql`'{}'::text[]`),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadInputTokens: integer('cache_read_input_tokens').notNull().default(0),
    cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull().default(0),
    // İsteğin gönderilmesinden cevabın bitmesine kadar.
    durationMs: integer('duration_ms').notNull(),
    // İlk metin parçasına kadar geçen süre; metin üretmeyen çağrıda (yalnızca araç çağrısı) boş.
    firstTokenMs: integer('first_token_ms'),
    // Dolar cinsinden; çağrı anındaki fiyatla, token sayılarından SQL'de hesaplanır.
    costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).notNull(),
    // Modelin bitiş nedeni (end_turn, tool_use, refusal, max_tokens…). API yeni değer ekleyebileceği için enum değil.
    stopReason: text('stop_reason'),
    // Çağrı başarısızsa hata kodu (zaman aşımı, API hatası…).
    errorCode: text('error_code'),
    ...createdAtOnly,
  },
  (t) => [
    // Mesaj silinince (hesap silme) yalnızca message_id boşalır; organization_id kalır. drizzle-kit kolon listeli
    // SET NULL üretemediği için migration'da elle yazıldı: ON DELETE SET NULL (message_id).
    foreignKey({
      name: 'ai_runs_message_fk',
      columns: [t.organizationId, t.messageId],
      foreignColumns: [messages.organizationId, messages.id],
    }).onDelete('set null'),
    // Şirketin günlük token bütçesi ve maliyet raporu.
    index('ai_runs_org_created_idx').on(t.organizationId, t.createdAt),
    // Kullanıcının günlük token bütçesi; hesap silinirken de kullanılır.
    index('ai_runs_user_created_idx').on(t.userId, t.createdAt),
    // Bir mesajın cevabındaki çağrılar (mesaj başına süre, token ve maliyet).
    index('ai_runs_org_message_idx').on(t.organizationId, t.messageId),
    check('ai_runs_round_no_positive', sql`${t.roundNo} >= 1`),
    check('ai_runs_model_not_blank', sql`length(trim(${t.model})) > 0`),
    check('ai_runs_prompt_version_not_blank', sql`length(trim(${t.promptVersion})) > 0`),
    check(
      'ai_runs_tokens_non_negative',
      sql`least(${t.inputTokens}, ${t.outputTokens}, ${t.cacheReadInputTokens}, ${t.cacheCreationInputTokens}) >= 0`,
    ),
    check('ai_runs_durations_non_negative', sql`${t.durationMs} >= 0 and ${t.firstTokenMs} >= 0`),
    check('ai_runs_cost_non_negative', sql`${t.costUsd} >= 0`),
    // Maliyet ve kullanım bilgisini yalnızca şirketin yöneticileri okur.
    adminCanRead('ai_runs', t.organizationId),
  ],
).enableRLS();
