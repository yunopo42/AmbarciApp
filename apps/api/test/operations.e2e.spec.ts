import { randomUUID } from 'node:crypto';

import { apiErrorSchema, IDEMPOTENCY_HEADER, ORGANIZATION_HEADER } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { WarehousesRepository } from '../src/modules/inventory/warehouses.repository.js';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository.js';
import { createTestApp } from './create-test-app.js';
import { InMemoryStore, inMemoryOrganizationsRepository, inMemoryWarehousesRepository } from './support/in-memory-repositories.js';
import { createTestTokens } from './support/test-tokens.js';

// İşlem uçlarının veritabanına gitmeden önce durdurduğu istekler: şema, Idempotency-Key, rol ve depo yetkisi.
// Stok transaction'ı, maliyet ve tekrar davranışı gerçek veritabanında sınanır (test-db/operations.db.spec.ts).

const ADMIN = randomUUID();
const EMPLOYEE = randomUUID();

describe('İşlem uçları: doğrulama ve yetki', () => {
  let store: InMemoryStore;
  let app: INestApplication<App>;
  let org: string;
  let allowedWarehouse: string;
  let otherWarehouse: string;
  const tokenOf = new Map<string, string>();
  let tokens: Awaited<ReturnType<typeof createTestTokens>>;

  beforeAll(async () => {
    tokens = await createTestTokens();
    for (const userId of [ADMIN, EMPLOYEE]) {
      tokenOf.set(userId, await tokens.tokenFor(userId));
    }
  });

  beforeEach(async () => {
    store = new InMemoryStore();
    org = store.addOrganization('A Elektrik');
    store.addMember(org, ADMIN, 'ADMIN');
    const employeeMembership = store.addMember(org, EMPLOYEE, 'EMPLOYEE');
    allowedWarehouse = store.addWarehouse(org, 'Merkez Depo');
    otherWarehouse = store.addWarehouse(org, 'Ostim Depo');
    store.access.add(`${org}:${employeeMembership}:${allowedWarehouse}`);
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
  function post(path: string, userId: string): request.Test {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokenOf.get(userId) ?? ''}`)
      .set(ORGANIZATION_HEADER, org);
  }

  function errorCode(body: unknown): string {
    return apiErrorSchema.parse(body).error.code;
  }

  const stockOut = (warehouseId: string): Record<string, unknown> => ({
    type: 'STOCK_OUT',
    items: [{ productId: randomUUID(), warehouseId, quantity: '2' }],
  });

  it('oturum yoksa 401', async () => {
    await request(app.getHttpServer()).post('/v1/operations').send(stockOut(allowedWarehouse)).expect(401);
  });

  it('şemaya uymayan gövde: 400 VALIDATION_FAILED ve alan ayrıntısı', async () => {
    const response = await post('/v1/operations', ADMIN)
      .send({ type: 'TRANSFER', items: [{ productId: randomUUID(), warehouseId: allowedWarehouse, quantity: '1,5' }] })
      .expect(400);
    const error = apiErrorSchema.parse(response.body).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.details as { path: string }[]).map((detail) => detail.path).sort()).toEqual([
      'items.0.quantity',
      'items.0.targetWarehouseId',
    ]);
  });

  it('çalışan yetkisi olmayan depoda işlem açamaz: 403 WAREHOUSE_FORBIDDEN', async () => {
    const response = await post('/v1/operations', EMPLOYEE).send(stockOut(otherWarehouse)).expect(403);
    const error = apiErrorSchema.parse(response.body).error;
    expect(error.code).toBe('WAREHOUSE_FORBIDDEN');
    expect(error.details).toEqual({ warehouseIds: [otherWarehouse] });
  });

  it('transferde hedef depo da yetki ister', async () => {
    const response = await post('/v1/operations', EMPLOYEE)
      .send({
        type: 'TRANSFER',
        items: [{ productId: randomUUID(), warehouseId: allowedWarehouse, targetWarehouseId: otherWarehouse, quantity: '1' }],
      })
      .expect(403);
    expect(errorCode(response.body)).toBe('WAREHOUSE_FORBIDDEN');
  });

  it('açılış stoğunu yalnızca yönetici girer: 403 ROLE_FORBIDDEN', async () => {
    const response = await post('/v1/operations', EMPLOYEE)
      .send({ type: 'OPENING', items: [{ productId: randomUUID(), warehouseId: allowedWarehouse, quantity: '10' }] })
      .expect(403);
    expect(errorCode(response.body)).toBe('ROLE_FORBIDDEN');
  });

  it('onay Idempotency-Key ister: yoksa ya da geçersizse 400', async () => {
    const path = `/v1/operations/${randomUUID()}/confirm`;
    const missing = await post(path, ADMIN).send({ version: 1 }).expect(400);
    expect(errorCode(missing.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    // 8 karakterden kısa.
    const invalid = await post(path, ADMIN).set(IDEMPOTENCY_HEADER, 'abc').send({ version: 1 }).expect(400);
    expect(errorCode(invalid.body)).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('onay gövdesinde sürüm zorunlu', async () => {
    const response = await post(`/v1/operations/${randomUUID()}/confirm`, ADMIN)
      .set(IDEMPOTENCY_HEADER, randomUUID())
      .send({})
      .expect(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });
});
