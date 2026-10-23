import { Module } from '@nestjs/common';

import { AuditRepository } from './audit.repository.js';
import { AuditService } from './audit.service.js';

/** Denetim kaydı (audit_logs). Okuma ekranı yönetici paneliyle birlikte gelir. */
@Module({
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
