// Stok testleri için ortak kurulum: geçici bir şirket, yönetici, iki depo; ürünler testlerde eklenir. API gerçek
// veritabanıyla çalışır, token'lar testin kendi anahtarıyla imzalanır. close() oluşturulan her şeyi siler.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@ambarci/db';
import type { Database } from '@ambarci/db';
import { confirmOperationResultSchema, IDEMPOTENCY_HEADER, operationSchema, ORGANIZATION_HEADER } from '@ambarci/shared';
import type { ConfirmOperationResult, Operation } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';

import { createTestApp } from '../../test/create-test-app.js';
import { createTestTokens } from '../../test/support/test-tokens.js';

const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error('DATABASE_URL tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
  }
  return value;
}

export type Item = { productId: string; warehouseId: string; quantity: string } & Record<string, unknown>;

export interface StockFixture {
  app: INestApplication<App>;
  /** Testin kendi bağlantı havuzu (API'ninkinden ayrı): kilit tutmak ve sonucu okumak için. */
  db: Database;
  org: string;
  admin: string;
  main: string;
  branch: string;
  addProduct: (sku: string) => Promise<string>;
  /** Şirkete yeni bir üye ekler (kullanıcı kimliğini döner); close() onu da siler. */
  addMember: (role: 'ADMIN' | 'EMPLOYEE') => Promise<string>;
  /** Verilen kullanıcı adına (varsayılan: yönetici) şirkete bağlı istek. Senkron, bkz. confirm. */
  call: (method: 'get' | 'post' | 'put', path: string, userId?: string) => request.Test;
  open: (type: string, items: Item[]) => Promise<Operation>;
  /** Senkron: supertest isteği "thenable"dır; await edilirse .expect() çağrılmadan gönderilir. */
  confirm: (operation: Operation, key?: string) => request.Test;
  apply: (type: string, items: Item[]) => Promise<ConfirmOperationResult>;
  stockOf: (warehouseId: string, productId: string) => Promise<{ quantity: string; averageCost: string } | null>;
  statusOf: (operationId: string) => Promise<string | undefined>;
  /** Bir işlemin yazılmış hareket, denetim (operation.applied) ve outbox kayıtlarının sayısı. */
  writtenFor: (operationId: string) => Promise<{ movements: number; audits: number; events: number }>;
  close: () => Promise<void>;
}

export interface StockFixtureOptions {
  label: string;
  /** API'nin sağlayıcılarının yerine geçecekler (ör. sorgu sayan veritabanı bağlantısı). */
  overrides?: { provide: unknown; useValue: unknown }[];
}

export async function createStockFixture(options: StockFixtureOptions): Promise<StockFixture> {
  // Kilit tutan bir transaction ile kilit bekleyenleri izleyen sorgu aynı anda çalışabilsin diye en az 3 bağlantı.
  const connection = createDatabase(databaseUrl(), { maxConnections: 4 });
  const { db } = connection;
  const org = randomUUID();
  const admin = randomUUID();
  const main = randomUUID();
  const branch = randomUUID();

  const tokens = await createTestTokens();
  const token = await tokens.tokenFor(admin);
  await db.execute(sql`insert into auth.users (id, email) values (${admin}, ${`stok-${admin}@test.invalid`})`);
  await db.execute(sql`insert into organizations (id, name) values (${org}, ${`${options.label} ${org.slice(0, 8)}`})`);
  await db.execute(sql`insert into organization_users (organization_id, user_id, role) values (${org}, ${admin}, 'ADMIN')`);
  await db.execute(sql`insert into warehouses (id, organization_id, name) values
    (${main}, ${org}, 'Merkez'), (${branch}, ${org}, 'Ostim')`);

  const app = await createTestApp({ accessTokenVerifier: tokens.verifier, overrides: options.overrides });

  const tokenOf = new Map<string, string>([[admin, token]]);
  const call = (method: 'get' | 'post' | 'put', path: string, userId: string = admin): request.Test => {
    const agent = request(app.getHttpServer());
    return agent[method](path).set('Authorization', `Bearer ${tokenOf.get(userId) ?? ''}`).set(ORGANIZATION_HEADER, org);
  };
  const post = (path: string): request.Test => call('post', path);

  const confirm = (operation: Operation, key: string = randomUUID()): request.Test =>
    post(`/v1/operations/${operation.id}/confirm`).set(IDEMPOTENCY_HEADER, key).send({ version: operation.version });

  const open = async (type: string, items: Item[]): Promise<Operation> => {
    const response = await post('/v1/operations').send({ type, items }).expect(201);
    return operationSchema.parse(response.body);
  };

  return {
    app,
    db,
    org,
    admin,
    main,
    branch,
    async addProduct(sku) {
      const id = randomUUID();
      await db.execute(sql`insert into products (id, organization_id, sku, name, base_unit)
        values (${id}, ${org}, ${sku}, ${`Test ürünü ${sku}`}, 'adet')`);
      return id;
    },
    async addMember(role) {
      const userId = randomUUID();
      await db.execute(sql`insert into auth.users (id, email) values (${userId}, ${`stok-${userId}@test.invalid`})`);
      await db.execute(sql`insert into organization_users (organization_id, user_id, role) values (${org}, ${userId}, ${role})`);
      tokenOf.set(userId, await tokens.tokenFor(userId));
      return userId;
    },
    call,
    open,
    confirm,
    async apply(type, items) {
      const response = await confirm(await open(type, items)).expect(200);
      return confirmOperationResultSchema.parse(response.body);
    },
    async stockOf(warehouseId, productId) {
      const [row] = await db.execute<{ quantity: string; averageCost: string }>(sql`
        select quantity, average_cost as "averageCost" from inventory
        where organization_id = ${org} and warehouse_id = ${warehouseId} and product_id = ${productId}`);
      return row ?? null;
    },
    async statusOf(operationId) {
      const [row] = await db.execute<{ status: string }>(sql`select status from operations where id = ${operationId}`);
      return row?.status;
    },
    async writtenFor(operationId) {
      const [row] = await db.execute<{ movements: number; audits: number; events: number }>(sql`
        select (select count(*)::int from inventory_movements where operation_id = ${operationId}) as movements,
               (select count(*)::int from audit_logs
                where entity_id = ${operationId} and action = 'operation.applied') as audits,
               (select count(*)::int from outbox_events where payload->>'operationId' = ${operationId}) as events`);
      return row ?? { movements: -1, audits: -1, events: -1 };
    },
    async close() {
      await app.close();
      for (const table of [
        'outbox_events',
        'audit_logs',
        'stock_counts',
        'inventory_movements',
        'operation_items',
        'operations',
        'inventory',
        'product_aliases',
        'product_units',
        'products',
        'parties',
        'user_warehouse_access',
        'organization_users',
        'warehouses',
      ]) {
        await db.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${org}`);
      }
      await db.execute(sql`delete from organizations where id = ${org}`);
      const users = sql.join([...tokenOf.keys()].map((id) => sql`${id}`), sql`, `);
      await db.execute(sql`delete from auth.users where id in (${users})`);
      await connection.close();
    },
  };
}

/** Bir stok satırını kilitleyen ifade (testin kendi transaction'ında). */
export function lockStockRow(org: string, warehouseId: string, productId: string): SQL {
  return sql`select 1 from inventory
    where organization_id = ${org} and warehouse_id = ${warehouseId} and product_id = ${productId} for update`;
}

/**
 * Yarışı rastlantıya bırakmadan kurar: test, verilen satırları kendi transaction'ında kilitler; start() ile
 * istekleri gönderir ve PostgreSQL'de en az `waiters` oturum kilit bekler hâle gelene kadar bekler; sonra
 * transaction'ı bitirip kilidi bırakır. Böylece istekler gerçekten aynı anda aynı satıra yarışır.
 */
export async function raceWhileLocked<T>(
  db: Database,
  locks: SQL[],
  waiters: number,
  start: () => PromiseLike<T>[],
): Promise<T[]> {
  let running: Promise<T[]> | undefined;
  await db.transaction(async (tx) => {
    for (const lock of locks) {
      await tx.execute(lock);
    }
    running = Promise.all(start());
    await waitForLockWaiters(db, waiters);
  });
  if (!running) {
    throw new Error('İstekler başlatılmadı.');
  }
  return running;
}

async function waitForLockWaiters(db: Database, expected: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
    if ((row?.waiting ?? 0) >= expected) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`${expected} oturumun kilit beklemesi beklendi; bekleyen: ${row?.waiting ?? 0}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
