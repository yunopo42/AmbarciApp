import { outboxEvents } from '@ambarci/db';
import type { DbExecutor } from '@ambarci/db';
import { Injectable } from '@nestjs/common';

export interface OutboxEvent {
  organizationId: string;
  /** "nesne.eylem": operation.applied… */
  eventType: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxRepository {
  async insert(executor: DbExecutor, event: OutboxEvent): Promise<void> {
    await executor.insert(outboxEvents).values(event);
  }
}
