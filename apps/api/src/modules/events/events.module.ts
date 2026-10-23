import { Module } from '@nestjs/common';

import { OutboxRepository } from './outbox.repository.js';
import { OutboxService } from './outbox.service.js';

/** Outbox (outbox_events). Olayları okuyan worker ve pg-boss işleri 5–6. haftada eklenecek. */
@Module({
  providers: [OutboxRepository, OutboxService],
  exports: [OutboxService],
})
export class EventsModule {}
