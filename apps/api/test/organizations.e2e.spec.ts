import { randomUUID } from 'node:crypto';

import { apiErrorSchema, invitationSchema, ORGANIZATION_HEADER, organizationMembershipSchema } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { WarehousesRepository } from '../src/modules/inventory/warehouses.repository.js';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository.js';
import { createTestApp } from './create-test-app.js';
import { InMemoryStore, inMemoryOrganizationsRepository, inMemoryWarehousesRepository } from './support/in-memory-repositories.js';
import { createTestTokens } from './support/test-tokens.js';
import type { TestTokens } from './support/test-tokens.js';

// Şirket bağlamı, roller, depo yetkisi ve davet kuralları. Veritabanı yerine bellek içi repository kullanılır;
// kilit ve kısıt davranışı test-db/ altındaki gerçek veritabanı testlerinde sınanır.

const ADMIN_A = randomUUID();
const EMPLOYEE_A = randomUUID();
const INACTIVE_A = randomUUID();
const ADMIN_B = randomUUID();
const NEWCOMER = randomUUID();

describe('Şirket bağlamı, roller ve davetler', () => {
  let tokens: TestTokens;
  let store: InMemoryStore;
  let app: INestApplication<App>;
  let orgA: string;
  let orgB: string;
  let warehouseA: string;
  let otherWarehouseA: string;
  let warehouseB: string;
  let employeeMembership: string;

  const tokenOf = new Map<string, string>();

  beforeAll(async () => {
    tokens = await createTestTokens();
    for (const userId of [ADMIN_A, EMPLOYEE_A, INACTIVE_A, ADMIN_B, NEWCOMER]) {
      tokenOf.set(userId, await tokens.tokenFor(userId));
    }
  });

  beforeEach(async () => {
    store = new InMemoryStore();
    orgA = store.addOrganization('A Elektrik');
    orgB = store.addOrganization('B Tesisat');
    store.addMember(orgA, ADMIN_A, 'ADMIN');
    employeeMembership = store.addMember(orgA, EMPLOYEE_A, 'EMPLOYEE');
    store.addMember(orgA, INACTIVE_A, 'EMPLOYEE', false);
    store.addMember(orgB, ADMIN_B, 'ADMIN');
    warehouseA = store.addWarehouse(orgA, 'Merkez Depo');
    otherWarehouseA = store.addWarehouse(orgA, 'Ostim Depo');
    warehouseB = store.addWarehouse(orgB, 'Merkez Depo');
    app = await createTestApp({
      accessTokenVerifier: tokens.verifier,
      overrides: [
        { provide: OrganizationsRepository, useValue: inMemoryOrganizationsRepository(store) },
        { provide: WarehousesRepository, useValue: inMemoryWarehousesRepository(store) },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // Senkron olmalı: supertest isteği "thenable"dır; await edilirse .expect() çağrılmadan gönderilir.
  function call(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    userId: string,
    organizationId?: string,
  ): request.Test {
    let req = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${tokenOf.get(userId) ?? ''}`);
    if (organizationId) {
      req = req.set(ORGANIZATION_HEADER, organizationId);
    }
    return req;
  }

  function errorCode(body: unknown): string {
    return apiErrorSchema.parse(body).error.code;
  }

  describe('aktif şirket (X-Organization-Id)', () => {
    it('başlık yoksa 400 ORGANIZATION_REQUIRED', async () => {
      const response = await call('get', '/v1/warehouses', ADMIN_A).expect(400);
      expect(errorCode(response.body)).toBe('ORGANIZATION_REQUIRED');
    });

    it('başlık UUID değilse 400 ORGANIZATION_INVALID', async () => {
      const response = await call('get', '/v1/warehouses', ADMIN_A, 'abc').expect(400);
      expect(errorCode(response.body)).toBe('ORGANIZATION_INVALID');
    });

    it('üyesi olunmayan şirket: 403 ORGANIZATION_FORBIDDEN', async () => {
      const response = await call('get', '/v1/warehouses', ADMIN_A, orgB).expect(403);
      expect(errorCode(response.body)).toBe('ORGANIZATION_FORBIDDEN');
    });

    it('var olmayan şirket de aynı 403 ile reddedilir (varlık sızmaz)', async () => {
      const response = await call('get', '/v1/warehouses', ADMIN_A, randomUUID()).expect(403);
      expect(errorCode(response.body)).toBe('ORGANIZATION_FORBIDDEN');
    });

    it('pasif üye: 403', async () => {
      await call('get', '/v1/warehouses', INACTIVE_A, orgA).expect(403);
    });

    it('token yoksa şirket kontrolüne gelmeden 401', async () => {
      await request(app.getHttpServer()).get('/v1/warehouses').set(ORGANIZATION_HEADER, orgA).expect(401);
    });

    it('üye yalnızca kendi şirketinin depolarını görür', async () => {
      const response = await call('get', '/v1/warehouses', EMPLOYEE_A, orgA).expect(200);
      const ids = (response.body as { id: string }[]).map((warehouse) => warehouse.id);
      expect(ids.sort()).toEqual([warehouseA, otherWarehouseA].sort());
      expect(ids).not.toContain(warehouseB);
    });
  });

  describe('roller', () => {
    it('çalışan davet kodu üretemez: 403 ROLE_FORBIDDEN', async () => {
      const response = await call('post', '/v1/invitations', EMPLOYEE_A, orgA).send({}).expect(403);
      expect(errorCode(response.body)).toBe('ROLE_FORBIDDEN');
    });

    it('çalışan üye listesini göremez: 403', async () => {
      await call('get', '/v1/members', EMPLOYEE_A, orgA).expect(403);
    });

    it('yönetici davet kodu üretir: 10 karakter, varsayılan rol çalışan, 7 gün', async () => {
      const response = await call('post', '/v1/invitations', ADMIN_A, orgA).send({}).expect(201);
      const invitation = invitationSchema.parse(response.body);
      expect(invitation.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
      expect(invitation.role).toBe('EMPLOYEE');
      const days = (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
    });

    it('geçersiz davet isteği: 400 VALIDATION_FAILED ve alan ayrıntısı', async () => {
      const response = await call('post', '/v1/invitations', ADMIN_A, orgA).send({ expiresInDays: 90 }).expect(400);
      const body = apiErrorSchema.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(body.error.details)).toContain('expiresInDays');
    });
  });

  describe('depo yetkisi', () => {
    it('yetkisi olmayan çalışan depo ayrıntısını göremez: 403 WAREHOUSE_FORBIDDEN', async () => {
      const response = await call('get', `/v1/warehouses/${warehouseA}`, EMPLOYEE_A, orgA).expect(403);
      expect(errorCode(response.body)).toBe('WAREHOUSE_FORBIDDEN');
    });

    it('yönetici yetki verince çalışan görür, kaldırınca göremez', async () => {
      await call('put', `/v1/members/${employeeMembership}/warehouses/${warehouseA}`, ADMIN_A, orgA).expect(204);
      await call('get', `/v1/warehouses/${warehouseA}`, EMPLOYEE_A, orgA).expect(200);
      // Yetki depo bazındadır: diğer depo hâlâ kapalı.
      await call('get', `/v1/warehouses/${otherWarehouseA}`, EMPLOYEE_A, orgA).expect(403);

      const members = await call('get', '/v1/members', ADMIN_A, orgA).expect(200);
      const employee = (members.body as { id: string; warehouseIds: string[] }[]).find((m) => m.id === employeeMembership);
      expect(employee?.warehouseIds).toEqual([warehouseA]);

      await call('delete', `/v1/members/${employeeMembership}/warehouses/${warehouseA}`, ADMIN_A, orgA).expect(204);
      await call('get', `/v1/warehouses/${warehouseA}`, EMPLOYEE_A, orgA).expect(403);
      const again = await call('delete', `/v1/members/${employeeMembership}/warehouses/${warehouseA}`, ADMIN_A, orgA).expect(404);
      expect(errorCode(again.body)).toBe('ACCESS_NOT_FOUND');
    });

    it('yönetici tüm depoları görür; başka şirketin deposu bulunmaz', async () => {
      await call('get', `/v1/warehouses/${warehouseA}`, ADMIN_A, orgA).expect(200);
      const response = await call('get', `/v1/warehouses/${warehouseB}`, ADMIN_A, orgA).expect(404);
      expect(errorCode(response.body)).toBe('WAREHOUSE_NOT_FOUND');
    });

    it('başka şirketin deposuna ya da üyesine yetki verilemez: 404', async () => {
      const warehouse = await call('put', `/v1/members/${employeeMembership}/warehouses/${warehouseB}`, ADMIN_A, orgA).expect(404);
      expect(errorCode(warehouse.body)).toBe('WAREHOUSE_NOT_FOUND');
      const memberOfB = store.memberships.find((row) => row.userId === ADMIN_B)?.id ?? '';
      const member = await call('put', `/v1/members/${memberOfB}/warehouses/${warehouseA}`, ADMIN_A, orgA).expect(404);
      expect(errorCode(member.body)).toBe('MEMBER_NOT_FOUND');
    });
  });

  describe('şirket oluşturma ve davetle katılma', () => {
    it('şirketi oluşturan yönetici olur ve şirket listesinde görünür', async () => {
      const created = await call('post', '/v1/organizations', NEWCOMER).send({ name: '  Yeni Şirket  ' }).expect(201);
      const organization = organizationMembershipSchema.parse(created.body);
      expect(organization).toMatchObject({ name: 'Yeni Şirket', role: 'ADMIN' });

      const list = await call('get', '/v1/organizations', NEWCOMER).expect(200);
      expect(list.body).toEqual([organization]);
    });

    it('çok kısa şirket adı: 400 VALIDATION_FAILED', async () => {
      const response = await call('post', '/v1/organizations', NEWCOMER).send({ name: 'A' }).expect(400);
      expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    });

    it('davet koduyla katılan kullanıcı davetteki rolle üye olur; kod ikinci kez kullanılamaz', async () => {
      const created = await call('post', '/v1/invitations', ADMIN_A, orgA).send({ role: 'EMPLOYEE' }).expect(201);
      const { code } = invitationSchema.parse(created.body);

      // Büyük/küçük harf ve tire farkı yok sayılır.
      const typed = `${code.slice(0, 5).toLowerCase()}-${code.slice(5)}`;
      const accepted = await call('post', '/v1/invitations/accept', NEWCOMER).send({ code: typed }).expect(200);
      expect(accepted.body).toEqual({ id: orgA, name: 'A Elektrik', role: 'EMPLOYEE' });
      await call('get', '/v1/warehouses', NEWCOMER, orgA).expect(200);

      const second = await call('post', '/v1/invitations/accept', ADMIN_B).send({ code }).expect(409);
      expect(errorCode(second.body)).toBe('INVITATION_USED');
    });

    it('süresi dolmuş kod: 410 INVITATION_EXPIRED', async () => {
      store.addInvitation({ organizationId: orgA, code: 'ESKIKOD234', role: 'EMPLOYEE', expiresAt: new Date(Date.now() - 1000), usedAt: null });
      const response = await call('post', '/v1/invitations/accept', NEWCOMER).send({ code: 'ESKIKOD234' }).expect(410);
      expect(errorCode(response.body)).toBe('INVITATION_EXPIRED');
    });

    it('bilinmeyen kod: 404 INVITATION_NOT_FOUND', async () => {
      const response = await call('post', '/v1/invitations/accept', NEWCOMER).send({ code: 'YOKBOYLE23' }).expect(404);
      expect(errorCode(response.body)).toBe('INVITATION_NOT_FOUND');
    });

    it('zaten üye olunan şirketin kodu: 409 ALREADY_MEMBER ve kod harcanmaz', async () => {
      const created = await call('post', '/v1/invitations', ADMIN_A, orgA).send({}).expect(201);
      const { code } = invitationSchema.parse(created.body);
      const response = await call('post', '/v1/invitations/accept', EMPLOYEE_A).send({ code }).expect(409);
      expect(errorCode(response.body)).toBe('ALREADY_MEMBER');
      await call('post', '/v1/invitations/accept', NEWCOMER).send({ code }).expect(200);
    });

    it('B şirketinin yöneticisi A şirketi için davet kodu üretemez', async () => {
      const response = await call('post', '/v1/invitations', ADMIN_B, orgA).send({}).expect(403);
      expect(errorCode(response.body)).toBe('ORGANIZATION_FORBIDDEN');
    });
  });
});
