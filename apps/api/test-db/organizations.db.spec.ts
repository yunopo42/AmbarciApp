// API'nin gerçek veritabanıyla davranışı: davet akışı, iki şirket arasında izolasyon (2. hafta kapısının
// API tarafı), aynı davet kodunun eşzamanlı kullanımı ve şirketler arası depo yetkisinin reddi.
// Geçici kullanıcılar auth.users'a doğrudan eklenir; test sonunda oluşturulan her şey silinir.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@ambarci/db';
import { apiErrorSchema, invitationSchema, ORGANIZATION_HEADER, organizationMembershipSchema } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from '../test/create-test-app.js';
import { createTestTokens } from '../test/support/test-tokens.js';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
}

const connection = createDatabase(databaseUrl, { maxConnections: 2 });
const { db } = connection;

const ADMIN_A = randomUUID();
const JOINER = randomUUID();
const ADMIN_C = randomUUID();
const RACER_1 = randomUUID();
const RACER_2 = randomUUID();
const USERS = [ADMIN_A, JOINER, ADMIN_C, RACER_1, RACER_2];

describe('Şirketler, davetler ve izolasyon (gerçek veritabanı)', () => {
  let app: INestApplication<App>;
  const tokenOf = new Map<string, string>();
  const createdOrganizations: string[] = [];
  let orgA = '';
  let orgC = '';
  let warehouseA = '';
  let warehouseC = '';

  // Senkron olmalı: supertest isteği "thenable"dır; await edilirse .expect() çağrılmadan gönderilir.
  function call(method: 'get' | 'post' | 'put', path: string, userId: string, organizationId?: string): request.Test {
    const req = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${tokenOf.get(userId) ?? ''}`);
    return organizationId ? req.set(ORGANIZATION_HEADER, organizationId) : req;
  }

  async function createOrganization(userId: string, name: string): Promise<string> {
    const response = await call('post', '/v1/organizations', userId).send({ name }).expect(201);
    const { id } = organizationMembershipSchema.parse(response.body);
    createdOrganizations.push(id);
    return id;
  }

  async function addWarehouse(organizationId: string, name: string): Promise<string> {
    // Depo yönetimi uçları 3. haftada; şimdilik doğrudan ekleniyor.
    const [row] = await db.execute<{ id: string }>(
      sql`insert into warehouses (organization_id, name) values (${organizationId}, ${name}) returning id`,
    );
    if (!row) {
      throw new Error('Depo eklenemedi.');
    }
    return row.id;
  }

  async function createInvitation(): Promise<string> {
    const response = await call('post', '/v1/invitations', ADMIN_A, orgA).send({}).expect(201);
    return invitationSchema.parse(response.body).code;
  }

  beforeAll(async () => {
    const tokens = await createTestTokens();
    for (const userId of USERS) {
      tokenOf.set(userId, await tokens.tokenFor(userId));
      await db.execute(sql`insert into auth.users (id, email) values (${userId}, ${`api-${userId}@test.invalid`})`);
    }
    app = await createTestApp({ accessTokenVerifier: tokens.verifier });

    const suffix = randomUUID().slice(0, 8);
    orgA = await createOrganization(ADMIN_A, `Test A ${suffix}`);
    orgC = await createOrganization(ADMIN_C, `Test C ${suffix}`);
    warehouseA = await addWarehouse(orgA, 'Merkez Depo');
    // Aynı depo adı: benzersizlik şirket içinde.
    warehouseC = await addWarehouse(orgC, 'Merkez Depo');
  });

  afterAll(async () => {
    await app?.close();
    if (createdOrganizations.length > 0) {
      const ids = sql.join(createdOrganizations.map((id) => sql`${id}`), sql`, `);
      await db.execute(sql`delete from user_warehouse_access where organization_id in (${ids})`);
      await db.execute(sql`delete from invitations where organization_id in (${ids})`);
      await db.execute(sql`delete from organization_users where organization_id in (${ids})`);
      await db.execute(sql`delete from warehouses where organization_id in (${ids})`);
      await db.execute(sql`delete from organizations where id in (${ids})`);
    }
    const users = sql.join(USERS.map((id) => sql`${id}`), sql`, `);
    await db.execute(sql`delete from auth.users where id in (${users})`);
    await connection.close();
  });

  it('şirket kur, davet et, kodla katıl, depo yetkisi ver', async () => {
    const code = await createInvitation();
    const accepted = await call('post', '/v1/invitations/accept', JOINER).send({ code }).expect(200);
    expect(accepted.body).toMatchObject({ id: orgA, role: 'EMPLOYEE' });

    // Çalışan, yetki verilmeden depo ayrıntısını göremez.
    await call('get', `/v1/warehouses/${warehouseA}`, JOINER, orgA).expect(403);

    const members = await call('get', '/v1/members', ADMIN_A, orgA).expect(200);
    const joiner = (members.body as { id: string; userId: string; email: string | null }[]).find((m) => m.userId === JOINER);
    expect(joiner?.email).toBe(`api-${JOINER}@test.invalid`);
    await call('put', `/v1/members/${joiner?.id}/warehouses/${warehouseA}`, ADMIN_A, orgA).expect(204);
    await call('get', `/v1/warehouses/${warehouseA}`, JOINER, orgA).expect(200);
  });

  it('iki şirket: API başka şirketin verisini vermez (kapı)', async () => {
    // Başlıkta başka şirket: üyelik yok.
    const aToC = await call('get', '/v1/warehouses', ADMIN_A, orgC).expect(403);
    expect(apiErrorSchema.parse(aToC.body).error.code).toBe('ORGANIZATION_FORBIDDEN');
    await call('get', '/v1/warehouses', ADMIN_C, orgA).expect(403);
    await call('get', '/v1/members', ADMIN_C, orgA).expect(403);
    await call('post', '/v1/invitations', ADMIN_C, orgA).send({}).expect(403);

    // Kendi şirketinde yalnızca kendi depoları.
    const listA = await call('get', '/v1/warehouses', ADMIN_A, orgA).expect(200);
    const idsA = (listA.body as { id: string }[]).map((warehouse) => warehouse.id);
    expect(idsA).toContain(warehouseA);
    expect(idsA).not.toContain(warehouseC);

    // Başka şirketin depo kimliği bilinse bile bulunmaz ve ona yetki verilemez.
    await call('get', `/v1/warehouses/${warehouseC}`, ADMIN_A, orgA).expect(404);
    const members = await call('get', '/v1/members', ADMIN_A, orgA).expect(200);
    const anyMember = (members.body as { id: string }[])[0]?.id;
    const grant = await call('put', `/v1/members/${anyMember}/warehouses/${warehouseC}`, ADMIN_A, orgA).expect(404);
    expect(apiErrorSchema.parse(grant.body).error.code).toBe('WAREHOUSE_NOT_FOUND');
  });

  it('aynı davet kodu aynı anda iki kez gönderilirse yalnızca biri üye olur', async () => {
    const code = await createInvitation();
    const results = await Promise.all([
      call('post', '/v1/invitations/accept', RACER_1).send({ code }),
      call('post', '/v1/invitations/accept', RACER_2).send({ code }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);

    const [row] = await db.execute<{ joined: number }>(
      sql`select count(*)::int as joined from organization_users
          where organization_id = ${orgA} and user_id in (${RACER_1}, ${RACER_2})`,
    );
    expect(row?.joined).toBe(1);
  });
});
