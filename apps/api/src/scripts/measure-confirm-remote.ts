// Onay transaction'ının çalışan bir API'deki (varsayılan: Render, Frankfurt) süresini ölçer (#34):
//   pnpm --filter @ambarci/api measure:remote
//
// Kendi bilgisayarında çalışır. Geçici bir şirket, depo ve ürünleri doğrudan veritabanına ekler (katalog uçları
// henüz yok), ölçüm kullanıcısıyla Supabase'e giriş yapar, işlemleri hedef API'ye HTTP ile açıp onaylar ve her
// onayın Server-Timing başlığındaki transaction süresini toplar. Sonunda geçici şirketi siler. Sonuç
// eval/gecikme/<etiket>-<tarih>.json dosyasına yazılır.
//
// Gerekenler (.env): DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, MEASURE_EMAIL, MEASURE_PASSWORD.
// İsteğe bağlı: MEASURE_API_URL (varsayılan Render adresi), MEASURE_REPEATS (20), MEASURE_LABEL.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@ambarci/db';
import type { Database } from '@ambarci/db';
import { IDEMPOTENCY_HEADER, operationSchema, ORGANIZATION_HEADER } from '@ambarci/shared';
import type { Operation } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { latencyScenarios, printReport, serverTimingOf, summarize, writeReport } from './latency.js';
import type { LatencyReport, LatencyScenario, ScenarioResult } from './latency.js';

// Derlenmiş dosya apps/api/dist/scripts/ altında çalışır; dört üst klasör depo köküdür.
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const envFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} tanımlı değil (.env).`);
  }
  return value;
}

const apiUrl = (process.env.MEASURE_API_URL?.trim() || 'https://ambarci-api.onrender.com').replace(/\/$/, '');
const repeats = Number(process.env.MEASURE_REPEATS ?? '20');
const label = process.env.MEASURE_LABEL?.trim() || (apiUrl.includes('onrender.com') ? 'render' : 'yerel-http');

const signInSchema = z.object({ access_token: z.string(), user: z.object({ id: z.uuid() }) });

/** Ölçüm kullanıcısıyla Supabase Auth'a e-posta + şifreyle giriş yapar; token yalnızca bellekte tutulur. */
async function signIn(): Promise<{ token: string; userId: string }> {
  const response = await fetch(`${required('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: required('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: required('MEASURE_EMAIL'), password: required('MEASURE_PASSWORD') }),
  });
  if (!response.ok) {
    throw new Error(`Supabase girişi başarısız (${response.status}). MEASURE_EMAIL ve MEASURE_PASSWORD'ü kontrol edin.`);
  }
  const body = signInSchema.parse(await response.json());
  return { token: body.access_token, userId: body.user.id };
}

/** Render'ın ücretsiz planı 15 dakika istek almazsa uyur; ilk istekte bir dakikaya kadar sürebilir. */
async function wakeUp(): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const response = await fetch(`${apiUrl}/v1/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Uyanırken bağlantı reddedilebilir; tekrar denenir.
    }
    if (Date.now() > deadline) {
      throw new Error(`${apiUrl} iki dakikada cevap vermedi.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

interface Fixture {
  org: string;
  main: string;
  branch: string;
  products: string[];
}

async function createFixture(db: Database, userId: string): Promise<Fixture> {
  const fixture: Fixture = { org: randomUUID(), main: randomUUID(), branch: randomUUID(), products: [] };
  const { org } = fixture;
  await db.execute(sql`insert into organizations (id, name) values (${org}, ${`Gecikme ölçümü ${org.slice(0, 8)}`})`);
  await db.execute(sql`insert into organization_users (organization_id, user_id, role) values (${org}, ${userId}, 'ADMIN')`);
  await db.execute(sql`insert into warehouses (id, organization_id, name) values
    (${fixture.main}, ${org}, 'Merkez'), (${fixture.branch}, ${org}, 'Ostim')`);
  for (let index = 1; index <= 5; index += 1) {
    const id = randomUUID();
    await db.execute(sql`insert into products (id, organization_id, sku, name, base_unit)
      values (${id}, ${org}, ${`OLCUM-${index}`}, ${`Ölçüm ürünü ${index}`}, 'adet')`);
    fixture.products.push(id);
  }
  return fixture;
}

async function removeFixture(db: Database, org: string): Promise<void> {
  for (const table of [
    'outbox_events',
    'audit_logs',
    'stock_counts',
    'inventory_movements',
    'operation_items',
    'operations',
    'inventory',
    'products',
    'organization_users',
    'warehouses',
  ]) {
    await db.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${org}`);
  }
  await db.execute(sql`delete from organizations where id = ${org}`);
}

async function main(): Promise<void> {
  const { token, userId } = await signIn();
  const connection = createDatabase(required('DATABASE_URL'), { maxConnections: 1 });
  const fixture = await createFixture(connection.db, userId);
  const headers = {
    Authorization: `Bearer ${token}`,
    [ORGANIZATION_HEADER]: fixture.org,
    'Content-Type': 'application/json',
  };

  const open = async (scenario: LatencyScenario): Promise<Operation> => {
    const response = await fetch(`${apiUrl}/v1/operations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: scenario.type, items: scenario.items }),
    });
    if (response.status !== 201) {
      throw new Error(`İşlem açılamadı (${response.status}): ${await response.text()}`);
    }
    return operationSchema.parse(await response.json());
  };

  const confirm = async (operation: Operation): Promise<{ requestMs: number; transactionMs: number }> => {
    const started = performance.now();
    const response = await fetch(`${apiUrl}/v1/operations/${operation.id}/confirm`, {
      method: 'POST',
      headers: { ...headers, [IDEMPOTENCY_HEADER]: randomUUID() },
      body: JSON.stringify({ version: operation.version }),
    });
    const requestMs = performance.now() - started;
    if (response.status !== 200) {
      throw new Error(`Onay başarısız (${response.status}): ${await response.text()}`);
    }
    const transactionMs = serverTimingOf(response.headers.get('server-timing') ?? undefined);
    if (transactionMs === null) {
      throw new Error('Server-Timing başlığı yok: hedef API bu ölçümü destekleyen sürümde mi?');
    }
    return { requestMs, transactionMs };
  };

  try {
    await wakeUp();
    const scenarios = latencyScenarios({ products: fixture.products, main: fixture.main, branch: fixture.branch });
    const [warmup] = scenarios;
    if (!warmup) {
      throw new Error('Senaryo yok.');
    }
    for (let index = 0; index < 3; index += 1) {
      await confirm(await open(warmup));
    }

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      const transaction: number[] = [];
      const requestTimes: number[] = [];
      for (let index = 0; index < repeats; index += 1) {
        const measured = await confirm(await open(scenario));
        transaction.push(measured.transactionMs);
        requestTimes.push(measured.requestMs);
      }
      results.push({ scenario: scenario.name, transaction: summarize(transaction), request: summarize(requestTimes) });
      console.log(`${scenario.name}: ${repeats} tekrar tamam.`);
    }

    const report: LatencyReport = { label, measuredAt: new Date().toISOString(), apiUrl, repeats, results };
    printReport(report);
    console.log(`Kaydedildi: ${writeReport(repoRoot, report)}`);
  } finally {
    await removeFixture(connection.db, fixture.org);
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('Ölçüm başarısız:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
