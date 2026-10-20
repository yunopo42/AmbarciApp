import type { AuthUser } from '@ambarci/shared';
import { HttpStatus } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';

import { ApiException } from '../../common/api-exception.js';
import { AccessTokenVerifier } from './access-token-verifier.js';

// Yalnızca Supabase'in JWKS'te yayınladığı asimetrik anahtarlarla imzalanmış token'lar kabul edilir.
// Ortak sırla (HS256) imzalanmış token'lar ve "none" reddedilir.
const ALLOWED_ALGORITHMS = ['ES256', 'RS256'];

// Oturum açmış kullanıcının token kitlesi. Anon anahtarı bu kitleye sahip değildir.
const AUDIENCE = 'authenticated';

/** Supabase Auth'un verdiği erişim token'larını projenin JWKS adresindeki açık anahtarlarla doğrular. */
export class SupabaseJwtVerifier extends AccessTokenVerifier {
  private readonly issuer: string;
  private readonly keys: JWTVerifyGetKey;

  constructor(issuer: string, keys: JWTVerifyGetKey) {
    super();
    this.issuer = issuer;
    this.keys = keys;
  }

  /** SUPABASE_URL değerinden (örn. https://<ref>.supabase.co) issuer ve JWKS adresini kurar. */
  static fromProjectUrl(projectUrl: string): SupabaseJwtVerifier {
    const origin = new URL(projectUrl).origin;
    // Anahtarlar ilk istekte indirilir ve önbellekte tutulur; bilinmeyen bir kid gelirse yeniden indirilir.
    const keys = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', origin));
    return new SupabaseJwtVerifier(`${origin}/auth/v1`, keys);
  }

  async verify(token: string): Promise<AuthUser> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: AUDIENCE,
        algorithms: ALLOWED_ALGORITHMS,
      }));
    } catch (error) {
      throw toAuthError(error);
    }

    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw invalidToken();
    }
    return { id: payload.sub, email: typeof payload['email'] === 'string' ? payload['email'] : null };
  }
}

function toAuthError(error: unknown): unknown {
  if (error instanceof errors.JWTExpired) {
    return new ApiException(HttpStatus.UNAUTHORIZED, 'AUTH_TOKEN_EXPIRED', 'Oturumun süresi doldu; yeniden giriş yapın.');
  }
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    // Token'ın değil, anahtar servisinin sorunu; istemci daha sonra tekrar deneyebilir.
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AUTH_UNAVAILABLE',
      'Kimlik doğrulama servisine ulaşılamadı; biraz sonra tekrar deneyin.',
    );
  }
  if (error instanceof errors.JOSEError) {
    return invalidToken();
  }
  // Ağ hatası gibi beklenmeyen durumlar 500 olarak loglanır.
  return error;
}

function invalidToken(): ApiException {
  return new ApiException(HttpStatus.UNAUTHORIZED, 'AUTH_INVALID_TOKEN', 'Oturum bilgisi geçersiz; yeniden giriş yapın.');
}
