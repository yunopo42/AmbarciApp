import type { DbExecutor } from '@ambarci/db';
import { Inject, Injectable } from '@nestjs/common';

import { OutboxRepository } from './outbox.repository.js';
import type { OutboxEvent } from './outbox.repository.js';

@Injectable()
export class OutboxService {
  constructor(@Inject(OutboxRepository) private readonly repository: OutboxRepository) {}

  /**
   * Olayı stok değişikliğiyle aynı transaction'da kuyruğa yazar (outbox deseni). Bildirim gibi yan etkiler
   * burada değil, olayı okuyan worker'da (5–6. hafta) çalışır: transaction geri alınırsa olay da hiç yazılmamış
   * olur, yani gerçekleşmemiş bir işlem için bildirim gitmez.
   */
  enqueue(executor: DbExecutor, event: OutboxEvent): Promise<void> {
    return this.repository.insert(executor, event);
  }
}
