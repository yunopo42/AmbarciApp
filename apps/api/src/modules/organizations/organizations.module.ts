import { Module } from '@nestjs/common';

import { InvitationsController } from './invitations.controller.js';
import { MembersController } from './members.controller.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsRepository } from './organizations.repository.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Şirket, üyelik, davet ve depo yetkileri. Diğer modüller şirket bağlamı için @OrganizationScoped()
 * dekoratörünü kullanır; guard'lar bu modülün dışa açtığı OrganizationsService ile üyeliği doğrular.
 */
@Module({
  controllers: [OrganizationsController, InvitationsController, MembersController],
  providers: [OrganizationsRepository, OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
