import type { DbExecutor } from '@ambarci/db';
import { Inject, Injectable } from '@nestjs/common';

import { AuditRepository } from './audit.repository.js';
import type { AuditEntry } from './audit.repository.js';

@Injectable()
export class AuditService {
  constructor(@Inject(AuditRepository) private readonly repository: AuditRepository) {}

  /**
   * Denetim kaydı yazar. executor, kaydı doğuran değişikliğin transaction'ıdır: değişiklik geri alınırsa
   * kayıt da yazılmamış olur; değişiklik olmadan kayıt, kayıt olmadan değişiklik kalmaz.
   */
  record(executor: DbExecutor, entry: AuditEntry): Promise<void> {
    return this.repository.insert(executor, entry);
  }
}
