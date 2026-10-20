import type { AuthUser } from '@ambarci/shared';
import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from './authenticated-request.js';

/** AuthGuard'ın doğruladığı kullanıcıyı uç nokta parametresine verir. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) {
    // @Public() uç noktada kullanılırsa programlama hatasıdır; 500 olarak loglanır.
    throw new Error('CurrentUser yalnızca oturum isteyen uç noktalarda kullanılabilir.');
  }
  return user;
});
