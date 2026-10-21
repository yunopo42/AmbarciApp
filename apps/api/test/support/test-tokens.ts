import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';

import { SupabaseJwtVerifier } from '../../src/modules/auth/supabase-jwt.verifier.js';

const ISSUER = 'https://test-project.supabase.co/auth/v1';
const KEY_ID = 'test-key';

export interface TestTokens {
  /** Testte üretilen anahtarla imzalanmış token'ları doğrulayan, ağa çıkmayan doğrulayıcı. */
  verifier: SupabaseJwtVerifier;
  /** Verilen kullanıcı için Supabase biçiminde erişim token'ı. */
  tokenFor: (userId: string, email?: string) => Promise<string>;
}

export async function createTestTokens(): Promise<TestTokens> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: KEY_ID, alg: 'ES256' };
  const signingKey: CryptoKey = privateKey;
  return {
    verifier: new SupabaseJwtVerifier(ISSUER, createLocalJWKSet({ keys: [publicJwk] })),
    tokenFor: (userId, email = `${userId}@test.invalid`) =>
      new SignJWT({ email, role: 'authenticated' })
        .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(signingKey),
  };
}
