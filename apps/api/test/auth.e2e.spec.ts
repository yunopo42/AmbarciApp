import { apiErrorSchema, authUserSchema } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { CryptoKey } from 'jose';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SupabaseJwtVerifier } from '../src/modules/auth/supabase-jwt.verifier.js';
import { createTestApp } from './create-test-app.js';

const ISSUER = 'https://test-project.supabase.co/auth/v1';
const USER_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KEY_ID = 'test-key';

interface TokenOptions {
  key?: CryptoKey;
  issuer?: string;
  audience?: string;
  subject?: string | null;
  /** Saniye cinsinden UNIX zamanı. */
  expiresAt?: number;
}

describe('Kimlik doğrulama (Supabase JWT)', () => {
  let app: INestApplication<App>;
  let signingKey: CryptoKey;
  let foreignKey: CryptoKey;

  async function token(options: TokenOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({ email: 'saha@ornek.com', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? 'authenticated')
      .setIssuedAt(now - 120)
      .setExpirationTime(options.expiresAt ?? now + 3600);
    if (options.subject !== null) {
      jwt.setSubject(options.subject ?? USER_ID);
    }
    return jwt.sign(options.key ?? signingKey);
  }

  function getMe(authorization?: string): request.Test {
    const req = request(app.getHttpServer()).get('/v1/auth/me');
    return authorization === undefined ? req : req.set('Authorization', authorization);
  }

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    signingKey = pair.privateKey;
    foreignKey = (await generateKeyPair('ES256')).privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KEY_ID, alg: 'ES256' };
    app = await createTestApp({
      accessTokenVerifier: new SupabaseJwtVerifier(ISSUER, createLocalJWKSet({ keys: [publicJwk] })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('geçerli token ile kullanıcıyı döner', async () => {
    const response = await getMe(`Bearer ${await token()}`).expect(200);

    expect(authUserSchema.parse(response.body)).toEqual({ id: USER_ID, email: 'saha@ornek.com' });
  });

  it('sağlık kontrolü token istemez', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(200);
  });

  it('token yoksa 401 AUTH_REQUIRED döner', async () => {
    const response = await getMe().expect(401);

    expect(apiErrorSchema.parse(response.body).error.code).toBe('AUTH_REQUIRED');
  });

  it('Bearer olmayan başlıkta 401 AUTH_REQUIRED döner', async () => {
    const response = await getMe(`Basic ${await token()}`).expect(401);

    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    ['bozuk token', async (): Promise<string> => 'bozuk.token.degeri'],
    ['başka anahtarla imzalı token', async (): Promise<string> => token({ key: foreignKey })],
    ['başka projenin token’ı (issuer farklı)', async (): Promise<string> => token({ issuer: 'https://baska.supabase.co/auth/v1' })],
    ['oturumsuz kitle (audience farklı)', async (): Promise<string> => token({ audience: 'anon' })],
    ['kullanıcı kimliği (sub) olmayan token', async (): Promise<string> => token({ subject: null })],
    [
      'ortak sırla (HS256) imzalı token',
      async (): Promise<string> =>
        new SignJWT({ role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(USER_ID)
          .setIssuer(ISSUER)
          .setAudience('authenticated')
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode('tahmin-edilebilir-ortak-sir-en-az-32-bayt')),
    ],
  ])('%s: 401 AUTH_INVALID_TOKEN döner', async (_name, makeToken) => {
    const response = await getMe(`Bearer ${await makeToken()}`).expect(401);

    expect(apiErrorSchema.parse(response.body).error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('süresi dolmuş token: 401 AUTH_TOKEN_EXPIRED döner', async () => {
    const expired = await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 });

    const response = await getMe(`Bearer ${expired}`).expect(401);

    expect(response.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('bilinmeyen adres ortak hata biçiminde 404 döner', async () => {
    const response = await request(app.getHttpServer()).get('/v1/olmayan-adres').expect(404);

    expect(apiErrorSchema.parse(response.body).error.code).toBe('NOT_FOUND');
  });
});

describe('Kimlik doğrulama servisine ulaşılamazsa', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const unreachable = async (): Promise<never> => {
      throw new errors.JWKSTimeout();
    };
    app = await createTestApp({ accessTokenVerifier: new SupabaseJwtVerifier(ISSUER, unreachable) });
  });

  afterAll(async () => {
    await app.close();
  });

  it('503 AUTH_UNAVAILABLE döner', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(privateKey);

    const response = await request(app.getHttpServer())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(503);

    expect(response.body.error.code).toBe('AUTH_UNAVAILABLE');
  });
});
