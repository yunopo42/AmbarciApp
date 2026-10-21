import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAtOnly } from './common.ts';
import { organizations } from './organizations.ts';

/**
 * Outbox: stok transaction'ıyla aynı anda yazılan olaylar (ör. operation.applied). Bildirim, kritik stok
 * kontrolü gibi yan etkileri bu tabloyu okuyan worker yapar (5–6. hafta); stok kodu doğrudan bildirim
 * göndermez. Olay yalnızca transaction başarılı olursa vardır; transaction geri alınırsa olay da yazılmamış olur.
 *
 * İstemcilere tamamen kapalıdır: okuma politikası yoktur, okuma yetkisi de 0004 migration'ında geri alınır.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // "nesne.eylem" biçiminde: operation.applied…
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    // Worker olayı işleyince dolar; boş olanlar işlenmeyi bekler.
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    ...createdAtOnly,
  },
  (t) => [
    index('outbox_events_organization_id_idx').on(t.organizationId),
    // Worker yalnızca bekleyen olayları eskiden yeniye okur. Kısmi indeks işlenmiş olayları içermez;
    // tablo büyüse de indeks bekleyenler kadar küçük kalır.
    index('outbox_events_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.processedAt} is null`),
    check('outbox_events_event_type_format', sql`${t.eventType} ~ '^[a-z_]+[.][a-z_]+$'`),
    check('outbox_events_attempts_non_negative', sql`${t.attempts} >= 0`),
  ],
).enableRLS();
