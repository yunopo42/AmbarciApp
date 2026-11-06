import { randomUUID } from 'node:crypto';

import { apiErrorSchema, ORGANIZATION_HEADER } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository.js';
import { createTestApp } from './create-test-app.js';
import { InMemoryStore, inMemoryOrganizationsRepository } from './support/in-memory-repositories.js';
import { createTestTokens } from './support/test-tokens.js';

// Sohbet uçlarının veritabanına gitmeden önce durdurduğu istekler: oturum, şirket başlığı ve mesaj şeması.
// Akış, tekrar gönderim ve sohbet sahipliği gerçek veritabanında sınanır (test-db/conversations.db.spec.ts).

const USER = randomUUID();

describe('Sohbet uçları: oturum ve doğrulama', () => {
  let app: INestApplication<App>;
  let org: string;
  let token = '';

  beforeAll(async () => {
    const tokens = await createTestTokens();
    token = await tokens.tokenFor(USER);
    const store = new InMemoryStore();
    org = store.addOrganization('A Elektrik');
    store.addMember(org, USER, 'EMPLOYEE');
    app = await createTestApp({
      accessTokenVerifier: tokens.verifier,
      overrides: [{ provide: OrganizationsRepository, useValue: inMemoryOrganizationsRepository(store) }],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;
  const conversation = randomUUID();

  it.each([
    ['post', '/v1/conversations'],
    ['get', '/v1/conversations'],
    ['get', `/v1/conversations/${conversation}/messages`],
    ['post', `/v1/conversations/${conversation}/messages`],
  ] as const)('kimliksiz istek 401: %s %s', async (method, path) => {
    const response = await request(app.getHttpServer())[method](path).set(ORGANIZATION_HEADER, org).expect(401);
    expect(errorCode(response.body)).toBe('AUTH_REQUIRED');
  });

  it('şirket başlığı olmadan 400', async () => {
    const response = await request(app.getHttpServer()).get('/v1/conversations').set('Authorization', `Bearer ${token}`).expect(400);
    expect(errorCode(response.body)).toBeTruthy();
  });

  it.each([
    [{ text: 'priz' }],
    [{ clientMessageId: 'kimlik-değil', text: 'priz' }],
    [{ clientMessageId: randomUUID(), text: '   ' }],
    [{ clientMessageId: randomUUID(), text: 'a'.repeat(2001) }],
  ])('şemaya uymayan mesaj 400 VALIDATION_FAILED, akış açılmaz: %j', async (body) => {
    const response = await request(app.getHttpServer())
      .post(`/v1/conversations/${conversation}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .set(ORGANIZATION_HEADER, org)
      .send(body)
      .expect(400);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });
});
