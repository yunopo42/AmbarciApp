import { auditLogs } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import type { ActionSource } from '@ambarci/shared';
import { Injectable } from '@nestjs/common';

export interface AuditEntry {
  organizationId: string;
  /** Sistem işlemlerinde (seed) boş. */
  actorId: string | null;
  /** "nesne.eylem": operation.applied, operation.cancelled… */
  action: string;
  entityType: string;
  entityId: string;
  source: ActionSource;
  /** Kişisel veri (telefon, e-posta, VKN/TCKN) ve mesaj içeriği yazılmaz. */
  details?: Record<string, unknown>;
}

/** Denetim kaydı yalnızca eklenir; güncelleme ve silme yolu bilerek yoktur. */
@Injectable()
export class AuditRepository {
  async insert(executor: DbExecutor, entry: AuditEntry): Promise<void> {
    await executor.insert(auditLogs).values({ ...entry, details: entry.details ?? {} });
  }
}
