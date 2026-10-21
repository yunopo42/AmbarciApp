import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import { actionSource, createdAtOnly } from './common.ts';
import { organizations } from './organizations.ts';
import { adminCanRead } from './rls.ts';

/**
 * Denetim kaydı: kim, ne zaman, hangi kaynaktan (ekran, sohbet, belge…), hangi kayıtta ne yaptı. Yalnızca
 * eklenir. Kişisel veri (telefon, e-posta, VKN/TCKN) ve mesaj içeriği details alanına yazılmaz.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    // Sistem işlemlerinde (seed) boştur. Hesap silinince (KVKK) kayıt kalır, kişi bağlantısı boşalır.
    actorId: uuid('actor_id').references(() => authUsers.id, { onDelete: 'set null' }),
    // "nesne.eylem" biçiminde: operation.applied, operation.cancelled, product.created…
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    source: actionSource('source').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ...createdAtOnly,
  },
  (t) => [
    // Şirketin denetim listesi (en yeni önce) ve bir kaydın geçmişi.
    index('audit_logs_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_logs_org_entity_idx').on(t.organizationId, t.entityType, t.entityId),
    index('audit_logs_actor_idx').on(t.actorId),
    check('audit_logs_action_format', sql`${t.action} ~ '^[a-z_]+[.][a-z_]+$'`),
    check('audit_logs_entity_type_format', sql`${t.entityType} ~ '^[a-z_]+$'`),
    // Denetim kaydını yalnızca şirketin yöneticileri okur.
    adminCanRead('audit_logs', t.organizationId),
  ],
).enableRLS();
