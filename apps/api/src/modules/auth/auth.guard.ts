import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiException } from '../../common/api-exception.js';
import { AccessTokenVerifier } from './access-token-verifier.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Uygulama genelindeki guard: @Public() ile işaretlenmemiş her uç nokta geçerli bir
 * Supabase erişim token'ı ister ve doğrulanan kullanıcıyı isteğe ekler.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  // Bağımlılıklar açık anahtarla enjekte edilir; tip meta verisine (emitDecoratorMetadata) bağlı kalınmaz.
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenVerifier) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', 'Oturum açmanız gerekiyor.');
    }
    request.user = await this.verifier.verify(token);
    return true;
  }
}

function readBearerToken(header: string | undefined): string | undefined {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1];
}
