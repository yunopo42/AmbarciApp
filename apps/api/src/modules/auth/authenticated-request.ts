import type { AuthUser } from '@ambarci/shared';
import type { Request } from 'express';

/** AuthGuard'dan geçmiş istek. `user` alanını yalnızca guard yazar. */
export type AuthenticatedRequest = Request & { user?: AuthUser };
