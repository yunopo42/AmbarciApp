import { randomUUID } from 'node:crypto';

import { apiErrorSchema, ORGANIZATION_HEADER, warehouseSchema } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { WarehousesRepository } from '../src/modules/inventory/warehouses.repository.js';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository.js';
import { createTestApp } from './create-test-app.js';
import { InMemoryStore, inMemoryOrganizationsRepository, inMemoryWarehousesRepository } from './support/in-memory-repositories.js';
import { createTestTokens } from './support/test-tokens.js';

// Depo yönetimi (bellek içi repository ile) ve katalog uçlarının veritabanına gitmeden önce durdurduğu istekler:
// rol ve şema. Ürün ve cari yazma davranışı gerçek veritabanında sınanır (test-db/catalog.db.spec.ts).

const ADMIN = randomUUID();
const EMPLOYEE = randomUUID();

describe('Katalog ve depo yönetimi: yetki ve doğrulama', () => {
  let store: InMemoryStore;
  let app: INestApplication<App>;
  let org: string;
  let otherOrg: string;
  let warehouse: string;
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
    otherOrg = store.addOrganization('B Tesisat');
    store.addMember(org, ADMIN, 'ADMIN');
    store.addMember(org, EMPLOYEE, 'EMPLOYEE');
    warehouse = store.addWarehouse(org, 'Merkez Depo');
    store.addWarehouse(otherOrg, 'Ostim Depo');
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
  function call(method: 'post' | 'put', path: string, userId: string): request.Test {
    const agent = request(app.getHttpServer());
    return agent[method](path).set('Authorization', `Bearer ${tokenOf.get(userId) ?? ''}`).set(ORGANIZATION_HEADER, org);
  }

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  describe('depolar', () => {
    it('yönetici depo ekler; tür ve aktiflik varsayılanla gelir', async () => {
      const response = await call('post', '/v1/warehouses', ADMIN).send({ name: 'Servis Aracı 2', type: 'VEHICLE' }).expect(201);
      expect(warehouseSchema.parse(response.body)).toMatchObject({ name: 'Servis Aracı 2', type: 'VEHICLE', isActive: true });
    });

    it('aynı şirkette aynı ad: 409 WAREHOUSE_NAME_TAKEN; başka şirketteki aynı ad sorun değil', async () => {
      const taken = await call('post', '/v1/warehouses', ADMIN).send({ name: 'Merkez Depo' }).expect(409);
      expect(errorCode(taken.body)).toBe('WAREHOUSE_NAME_TAKEN');
      await call('post', '/v1/warehouses', ADMIN).send({ name: 'Ostim Depo' }).expect(201);
    });

    it('yönetici depoyu yeniden adlandırır ve pasife alır', async () => {
      const response = await call('put', `/v1/warehouses/${warehouse}`, ADMIN)
        .send({ name: 'Ana Depo', isActive: false })
        .expect(200);
      expect(response.body).toMatchObject({ id: warehouse, name: 'Ana Depo', isActive: false });
    });

    it('başka şirketin ya da olmayan depo: 404', async () => {
      const response = await call('put', `/v1/warehouses/${randomUUID()}`, ADMIN).send({ name: 'X' }).expect(404);
      expect(errorCode(response.body)).toBe('WAREHOUSE_NOT_FOUND');
    });

    it('çalışan depo ekleyemez ve değiştiremez: 403', async () => {
      await call('post', '/v1/warehouses', EMPLOYEE).send({ name: 'Yeni' }).expect(403);
      await call('put', `/v1/warehouses/${warehouse}`, EMPLOYEE).send({ name: 'Yeni' }).expect(403);
    });
  });

  describe('ürünler ve cariler', () => {
    it('çalışan ürün ve cari ekleyemez ya da değiştiremez: 403 ROLE_FORBIDDEN', async () => {
      const product = { sku: 'PRZ-1', name: 'Priz', baseUnit: 'adet' };
      const party = { name: 'Tedarikçi', type: 'SUPPLIER' };
      for (const response of [
        await call('post', '/v1/products', EMPLOYEE).send(product),
        await call('put', `/v1/products/${randomUUID()}`, EMPLOYEE).send(product),
        await call('post', '/v1/parties', EMPLOYEE).send(party),
        await call('put', `/v1/parties/${randomUUID()}`, EMPLOYEE).send(party),
      ]) {
        expect(response.status).toBe(403);
        expect(errorCode(response.body)).toBe('ROLE_FORBIDDEN');
      }
    });

    it('şemaya uymayan ürün: 400 ve alan ayrıntısı', async () => {
      const response = await call('post', '/v1/products', ADMIN)
        .send({ sku: 'PRZ-1', name: 'Priz', baseUnit: 'adet', units: [{ unit: 'adet', factor: '0' }] })
        .expect(400);
      const details = apiErrorSchema.parse(response.body).error.details as { path: string }[];
      expect(details.map((detail) => detail.path).sort()).toEqual(['units.0.factor', 'units.0.unit']);
    });
  });
});
