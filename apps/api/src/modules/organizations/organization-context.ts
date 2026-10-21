import type { OrganizationRole } from '@ambarci/shared';

import type { AuthenticatedRequest } from '../auth/authenticated-request.js';

/** OrganizationGuard'ın doğruladığı aktif şirket ve kullanıcının oradaki üyeliği. */
export interface OrganizationContext {
  id: string;
  role: OrganizationRole;
  membershipId: string;
}

/** `organization` alanını yalnızca OrganizationGuard yazar. */
export type OrganizationRequest = AuthenticatedRequest & { organization?: OrganizationContext };
