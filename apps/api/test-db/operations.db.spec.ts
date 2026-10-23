// Stok transaction'ı gerçek veritabanında: beş işlem türü, birim çevrimi, hareketli ortalama maliyet, yetersiz
// stok, aynı onayın tekrarı, sürüm, başka şirketin verisi, depo yetkisi ve açılış stoğu betiği. Eşzamanlı çıkış
// ve çok kalemli rollback senaryoları #34'te. Testler sırayla çalışır ve aynı stok üzerinde ilerler; sondaki
// beklenen değerler öncekilerin sonucudur. Oluşturulan her şey sonunda silinir.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@ambarci/db';
import type { Database } from '@ambarci/db';
import {
  apiErrorSchema,
  confirmOperationResultSchema,
  IDEMPOTENCY_HEADER,
  operationSchema,
  ORGANIZATION_HEADER,
} from '@ambarci/shared';
import type { ApiError, ConfirmOperationResult, Operation } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { OperationsService } from '../src/modules/operations/operations.service.js';
import { seedOpeningStock } from '../src/scripts/opening-stock.js';
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

const ADMIN = randomUUID();
const EMPLOYEE = randomUUID();
const ADMIN_B = randomUUID();
const USERS = [ADMIN, EMPLOYEE, ADMIN_B];

const ORG = randomUUID();
const ORG_B = randomUUID();
const MAIN = randomUUID(); // Merkez: çalışan yetkili
const BRANCH = randomUUID(); // Ostim: çalışan yetkisiz
const CLOSED = randomUUID(); // pasif depo
const MAIN_B = randomUUID();
const SOCKET = randomUUID(); // ana birim adet, 1 koli = 12 adet
const CABLE = randomUUID(); // ana birim metre, 1 makara = 100 metre
const PRODUCT_B = randomUUID();
const SUPPLIER = randomUUID();

type Item = { productId: string; warehouseId: string; quantity: string } & Record<string, unknown>;

describe("Stok transaction'ı (gerçek veritabanı)", () => {
  let app: INestApplication<App>;
  const tokenOf = new Map<string, string>();

  // Senkron olmalı: supertest isteği "thenable"dır; await edilirse .expect() çağrılmadan gönderilir.
  function post(path: string, userId: string, organizationId = ORG): request.Test {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokenOf.get(userId) ?? ''}`)
      .set(ORGANIZATION_HEADER, organizationId);
  }

  async function open(type: string, items: Item[], userId = ADMIN, extra: Record<string, unknown> = {}): Promise<Operation> {
    const response = await post('/v1/operations', userId).send({ type, items, ...extra }).expect(201);
    return operationSchema.parse(response.body);
  }

  function confirm(operation: Operation, userId = ADMIN, key: string = randomUUID()): request.Test {
    return post(`/v1/operations/${operation.id}/confirm`, userId)
      .set(IDEMPOTENCY_HEADER, key)
      .send({ version: operation.version });
  }

  async function apply(type: string, items: Item[], extra: Record<string, unknown> = {}): Promise<ConfirmOperationResult> {
    const response = await confirm(await open(type, items, ADMIN, extra)).expect(200);
    return confirmOperationResultSchema.parse(response.body);
  }

  async function stockOf(warehouseId: string, productId: string): Promise<{ quantity: string; averageCost: string }> {
    const [row] = await db.execute<{ quantity: string; averageCost: string }>(
      sql`select quantity, average_cost as "averageCost" from inventory
          where organization_id = ${ORG} and warehouse_id = ${warehouseId} and product_id = ${productId}`,
    );
    return row ?? { quantity: 'yok', averageCost: 'yok' };
  }

  async function statusOf(operationId: string): Promise<string | undefined> {
    const [row] = await db.execute<{ status: string }>(sql`select status from operations where id = ${operationId}`);
    return row?.status;
  }

  function errorOf(body: unknown): ApiError['error'] {
    return apiErrorSchema.parse(body).error;
  }

  beforeAll(async () => {
    const tokens = await createTestTokens();
    for (const userId of USERS) {
      tokenOf.set(userId, await tokens.tokenFor(userId));
      await db.execute(sql`insert into auth.users (id, email) values (${userId}, ${`stok-${userId}@test.invalid`})`);
    }
    const suffix = randomUUID().slice(0, 8);
    await db.execute(sql`insert into organizations (id, name) values (${ORG}, ${`Stok A ${suffix}`}), (${ORG_B}, ${`Stok B ${suffix}`})`);
    await db.execute(sql`
      insert into organization_users (organization_id, user_id, role) values
        (${ORG}, ${ADMIN}, 'ADMIN'), (${ORG}, ${EMPLOYEE}, 'EMPLOYEE'), (${ORG_B}, ${ADMIN_B}, 'ADMIN')`);
    const [employeeMembership] = await db.execute<{ id: string }>(
      sql`select id from organization_users where organization_id = ${ORG} and user_id = ${EMPLOYEE}`,
    );
    await db.execute(sql`
      insert into warehouses (id, organization_id, name, is_active) values
        (${MAIN}, ${ORG}, 'Merkez', true), (${BRANCH}, ${ORG}, 'Ostim', true), (${CLOSED}, ${ORG}, 'Eski', false),
        (${MAIN_B}, ${ORG_B}, 'Merkez', true)`);
    await db.execute(sql`insert into user_warehouse_access (organization_id, organization_user_id, warehouse_id)
      values (${ORG}, ${employeeMembership?.id}, ${MAIN})`);
    await db.execute(sql`
      insert into products (id, organization_id, sku, name, base_unit) values
        (${SOCKET}, ${ORG}, 'PRZ', 'Topraklı priz', 'adet'), (${CABLE}, ${ORG}, 'KBL', 'NYM kablo', 'metre'),
        (${PRODUCT_B}, ${ORG_B}, 'PRZ', 'Topraklı priz', 'adet')`);
    await db.execute(sql`
      insert into product_units (organization_id, product_id, unit, factor) values
        (${ORG}, ${SOCKET}, 'koli', '12'), (${ORG}, ${CABLE}, 'makara', '100')`);
    await db.execute(sql`insert into parties (id, organization_id, name, type) values (${SUPPLIER}, ${ORG}, 'Tedarikçi', 'SUPPLIER')`);

    app = await createTestApp({ accessTokenVerifier: tokens.verifier });
  });

  afterAll(async () => {
    await app?.close();
    const orgs = sql`(${ORG}, ${ORG_B})`;
    for (const table of [
      'outbox_events',
      'audit_logs',
      'stock_counts',
      'inventory_movements',
      'operation_items',
      'operations',
      'inventory',
      'product_units',
      'products',
      'parties',
      'user_warehouse_access',
      'organization_users',
      'warehouses',
    ]) {
      await db.execute(sql`delete from ${sql.identifier(table)} where organization_id in ${orgs}`);
    }
    await db.execute(sql`delete from organizations where id in ${orgs}`);
    await db.execute(sql`delete from auth.users where id in (${sql.join(USERS.map((id) => sql`${id}`), sql`, `)})`);
    await connection.close();
  });

  it('işlem açmak stoğu değiştirmez; işlem onay bekler', async () => {
    const operation = await open('STOCK_IN', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1' }]);
    expect(operation).toMatchObject({ status: 'PENDING_CONFIRMATION', version: 1, source: 'SCREEN', createdBy: ADMIN });
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: 'yok', averageCost: 'yok' });
    await post(`/v1/operations/${operation.id}/cancel`, ADMIN).expect(200);
  });

  it('giriş: koli ana birime çevrilir, birim maliyet ana birime bölünür', async () => {
    // 10 koli × 12 = 120 adet; koli 120 TL → adet 10 TL.
    const { operation, movements } = await apply(
      'STOCK_IN',
      [{ productId: SOCKET, warehouseId: MAIN, quantity: '10', unit: 'koli', unitCost: '120' }],
      { partyId: SUPPLIER },
    );
    expect(operation).toMatchObject({ status: 'APPLIED', appliedBy: ADMIN, partyId: SUPPLIER });
    expect(movements).toEqual([
      expect.objectContaining({ type: 'IN', quantityChange: '120.000', unitCost: '10.0000', quantityAfter: '120.000', averageCostAfter: '10.0000' }),
    ]);
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '120.000', averageCost: '10.0000' });
  });

  it('giriş: hareketli ağırlıklı ortalama; maliyetsiz giriş ortalamayı değiştirmez', async () => {
    // (120 × 10 + 60 × 13) ÷ 180 = 11
    await apply('STOCK_IN', [{ productId: SOCKET, warehouseId: MAIN, quantity: '60', unitCost: '13' }]);
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '180.000', averageCost: '11.0000' });

    const { movements } = await apply('STOCK_IN', [{ productId: SOCKET, warehouseId: MAIN, quantity: '20' }]);
    expect(movements[0]).toMatchObject({ unitCost: '11.0000', averageCostAfter: '11.0000' });
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '200.000', averageCost: '11.0000' });
  });

  it('çıkış: ortalama değişmez, hareket o anki ortalamayla yazılır', async () => {
    const { movements } = await apply('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '30' }]);
    expect(movements).toEqual([
      expect.objectContaining({ type: 'OUT', quantityChange: '-30.000', unitCost: '11.0000', quantityAfter: '170.000' }),
    ]);
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '170.000', averageCost: '11.0000' });
  });

  it('transfer: mal, çıktığı deponun ortalama maliyetiyle girer', async () => {
    const { movements } = await apply('TRANSFER', [
      { productId: SOCKET, warehouseId: MAIN, targetWarehouseId: BRANCH, quantity: '50' },
    ]);
    expect(movements.map((movement) => [movement.type, movement.warehouseId, movement.quantityChange])).toEqual([
      ['TRANSFER_OUT', MAIN, '-50.000'],
      ['TRANSFER_IN', BRANCH, '50.000'],
    ]);
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '120.000', averageCost: '11.0000' });
    expect(await stockOf(BRANCH, SOCKET)).toEqual({ quantity: '50.000', averageCost: '11.0000' });

    // Hedef depoya yeni alış: (50 × 11 + 50 × 15) ÷ 100 = 13. Kaynak deponun ortalaması etkilenmez.
    await apply('STOCK_IN', [{ productId: SOCKET, warehouseId: BRANCH, quantity: '50', unitCost: '15' }]);
    expect(await stockOf(BRANCH, SOCKET)).toEqual({ quantity: '100.000', averageCost: '13.0000' });
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '120.000', averageCost: '11.0000' });
  });

  it('fire stoktan düşer, ortalamayı değiştirmez', async () => {
    const { movements } = await apply('WASTE', [{ productId: SOCKET, warehouseId: MAIN, quantity: '5' }]);
    expect(movements[0]).toMatchObject({ type: 'WASTE', quantityChange: '-5.000' });
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '115.000', averageCost: '11.0000' });
  });

  it('sayım: sistemdeki miktar onay anında okunur; arada çıkış olsa da fark doğru çıkar', async () => {
    // Sayım açıldığında stok 115; sayılan 110.
    const count = await open('COUNT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '110' }]);
    // Sayım onaylanmadan önce 3 adet çıkış: stok 112.
    await apply('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '3' }]);
    const response = await confirm(count).expect(200);
    const { movements } = confirmOperationResultSchema.parse(response.body);
    // Fark 115 − 110 = 5 değil, 112 − 110 = 2.
    expect(movements).toEqual([expect.objectContaining({ type: 'COUNT_SHORTAGE', quantityChange: '-2.000', quantityAfter: '110.000' })]);
    const [result] = await db.execute<{ system: string; counted: string; difference: string }>(sql`
      select system_quantity as system, counted_quantity as counted, difference from stock_counts
      where operation_id = ${count.id}`);
    expect(result).toEqual({ system: '112.000', counted: '110.000', difference: '-2.000' });
  });

  it('sayım fazlası mevcut ortalamayla girer; fark yoksa hareket yazılmaz ama sonuç kalır', async () => {
    const surplus = await apply('COUNT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '120' }]);
    expect(surplus.movements).toEqual([
      expect.objectContaining({ type: 'COUNT_SURPLUS', quantityChange: '10.000', unitCost: '11.0000', averageCostAfter: '11.0000' }),
    ]);
    const same = await apply('COUNT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '120' }]);
    expect(same.movements).toEqual([]);
    const [result] = await db.execute<{ difference: string }>(
      sql`select difference from stock_counts where operation_id = ${same.operation.id}`,
    );
    expect(result?.difference).toBe('0.000');
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '120.000', averageCost: '11.0000' });
  });

  it('yetersiz stok: 409, hiçbir şey yazılmaz, işlem onay bekler durumda kalır', async () => {
    const operation = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1000' }]);
    const response = await confirm(operation).expect(409);
    const error = errorOf(response.body);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toEqual([
      { lineNo: 1, productId: SOCKET, warehouseId: MAIN, requested: '1000.000', available: '120.000' },
    ]);
    expect(await stockOf(MAIN, SOCKET)).toEqual({ quantity: '120.000', averageCost: '11.0000' });
    expect(await statusOf(operation.id)).toBe('PENDING_CONFIRMATION');
    const [written] = await db.execute<{ movements: number; events: number; applied: number }>(sql`
      select (select count(*)::int from inventory_movements where operation_id = ${operation.id}) as movements,
             (select count(*)::int from outbox_events where payload->>'operationId' = ${operation.id}) as events,
             (select count(*)::int from audit_logs where entity_id = ${operation.id} and action = 'operation.applied') as applied`);
    expect(written).toEqual({ movements: 0, events: 0, applied: 0 });
  });

  it('aynı onay iki kez stok değiştirmez; anahtar başka işlemde kullanılamaz', async () => {
    const key = randomUUID();
    const operation = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1' }]);
    const first = await confirm(operation, ADMIN, key).expect(200);
    const again = await confirm(operation, ADMIN, key).expect(200);
    expect(again.body).toEqual(first.body);
    expect(await stockOf(MAIN, SOCKET)).toMatchObject({ quantity: '119.000' });

    const otherKey = await confirm(operation).expect(409);
    expect(errorOf(otherKey.body).code).toBe('OPERATION_ALREADY_APPLIED');

    const another = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1' }]);
    const reused = await confirm(another, ADMIN, key).expect(409);
    expect(errorOf(reused.body).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await statusOf(another.id)).toBe('PENDING_CONFIRMATION');
    expect(await stockOf(MAIN, SOCKET)).toMatchObject({ quantity: '119.000' });
  });

  it('kullanıcının gördüğü sürüm eskiyse onay reddedilir; iptal edilen işlem onaylanamaz', async () => {
    const operation = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1' }]);
    const stale = await confirm({ ...operation, version: 2 }).expect(409);
    expect(errorOf(stale.body)).toMatchObject({ code: 'OPERATION_VERSION_MISMATCH', details: { currentVersion: 1 } });

    await post(`/v1/operations/${operation.id}/cancel`, ADMIN).expect(200);
    const cancelled = await confirm(operation).expect(409);
    expect(errorOf(cancelled.body)).toMatchObject({ code: 'OPERATION_NOT_PENDING', details: { status: 'CANCELLED' } });
  });

  it('başka şirketin işlemi ve ürünü: bulunamaz', async () => {
    const operation = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1' }]);
    // B şirketinin yöneticisi kendi şirketi adına A'nın işlem kimliğini gönderir.
    const foreign = await post(`/v1/operations/${operation.id}/confirm`, ADMIN_B, ORG_B)
      .set(IDEMPOTENCY_HEADER, randomUUID())
      .send({ version: 1 })
      .expect(404);
    expect(errorOf(foreign.body).code).toBe('OPERATION_NOT_FOUND');
    // A'nın başlığıyla: üye değil.
    await post(`/v1/operations/${operation.id}/confirm`, ADMIN_B).set(IDEMPOTENCY_HEADER, randomUUID()).send({ version: 1 }).expect(403);

    const response = await post('/v1/operations', ADMIN)
      .send({ type: 'STOCK_IN', items: [{ productId: PRODUCT_B, warehouseId: MAIN, quantity: '1' }] })
      .expect(422);
    expect(errorOf(response.body)).toMatchObject({
      code: 'OPERATION_LINES_INVALID',
      details: [{ lineNo: 1, field: 'productId', code: 'PRODUCT_NOT_FOUND' }],
    });
  });

  it('geçersiz kalemler satır numarasıyla bildirilir: birim, pasif depo, başka şirketin deposu', async () => {
    const response = await post('/v1/operations', ADMIN)
      .send({
        type: 'STOCK_IN',
        items: [
          { productId: SOCKET, warehouseId: MAIN, quantity: '1', unit: 'palet' },
          { productId: SOCKET, warehouseId: CLOSED, quantity: '1' },
          { productId: SOCKET, warehouseId: MAIN_B, quantity: '1' },
          { productId: SOCKET, warehouseId: MAIN, quantity: '1', unit: 'adet' },
        ],
      })
      .expect(422);
    expect(errorOf(response.body).details).toEqual([
      expect.objectContaining({ lineNo: 1, field: 'unit', code: 'UNIT_NOT_FOUND' }),
      expect.objectContaining({ lineNo: 2, field: 'warehouseId', code: 'WAREHOUSE_INACTIVE' }),
      expect.objectContaining({ lineNo: 3, field: 'warehouseId', code: 'WAREHOUSE_NOT_FOUND' }),
    ]);
  });

  it('çalışan yalnızca yetkili olduğu depodaki işlemi onaylayabilir', async () => {
    const elsewhere = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: BRANCH, quantity: '1' }]);
    const denied = await confirm(elsewhere, EMPLOYEE).expect(403);
    expect(errorOf(denied.body).code).toBe('WAREHOUSE_FORBIDDEN');
    expect(await statusOf(elsewhere.id)).toBe('PENDING_CONFIRMATION');

    const own = await open('STOCK_OUT', [{ productId: SOCKET, warehouseId: MAIN, quantity: '1' }], EMPLOYEE);
    await confirm(own, EMPLOYEE).expect(200);
    expect(await stockOf(MAIN, SOCKET)).toMatchObject({ quantity: '118.000' });
  });

  it("açılış stoğu betiği aynı transaction'dan geçer ve tekrar çalışınca stok ikinci kez girmez", async () => {
    const stocks = [{ warehouse: 'Ostim', lines: [{ sku: 'KBL', quantity: '500', unitCost: '2.50' }] }];
    const database = app.get<Database>(DATABASE);
    const operations = app.get(OperationsService);
    expect(await seedOpeningStock(database, operations, ORG, stocks)).toEqual([
      { warehouse: 'Ostim', status: 'applied', lineCount: 1 },
    ]);
    expect(await seedOpeningStock(database, operations, ORG, stocks)).toEqual([
      { warehouse: 'Ostim', status: 'skipped', lineCount: 1 },
    ]);
    expect(await stockOf(BRANCH, CABLE)).toEqual({ quantity: '500.000', averageCost: '2.5000' });
    const [row] = await db.execute<{ openings: number; source: string; actor: string | null }>(sql`
      select count(*)::int as openings, min(o.source::text) as source, min(a.actor_id::text) as actor
      from operations o join audit_logs a on a.entity_id = o.id and a.action = 'operation.applied'
      where o.organization_id = ${ORG} and o.type = 'OPENING'`);
    expect(row).toEqual({ openings: 1, source: 'SYSTEM', actor: null });
  });

  it('stok, hareketlerin toplamıdır; her uygulanan işlemin bir denetim ve bir outbox kaydı var', async () => {
    const mismatches = await db.execute(sql`
      select i.warehouse_id, i.product_id, i.quantity, coalesce(sum(m.quantity_change), 0) as total
      from inventory i
      left join inventory_movements m
        on m.organization_id = i.organization_id and m.warehouse_id = i.warehouse_id and m.product_id = i.product_id
      where i.organization_id = ${ORG}
      group by i.warehouse_id, i.product_id, i.quantity
      having i.quantity <> coalesce(sum(m.quantity_change), 0)`);
    expect(mismatches).toHaveLength(0);

    const [counts] = await db.execute<{ applied: number; audits: number; events: number }>(sql`
      select (select count(*)::int from operations where organization_id = ${ORG} and status = 'APPLIED') as applied,
             (select count(*)::int from audit_logs where organization_id = ${ORG} and action = 'operation.applied') as audits,
             (select count(*)::int from outbox_events where organization_id = ${ORG} and event_type = 'operation.applied') as events`);
    expect(counts?.audits).toBe(counts?.applied);
    expect(counts?.events).toBe(counts?.applied);
  });
});
