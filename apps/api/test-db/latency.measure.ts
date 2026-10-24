// Onay transaction'ının yerelden ölçülen süresi ve transaction başına SQL ifadesi sayısı (#34). Bu bir test değil,
// ölçümdür; pnpm db:test çalıştırmaz: pnpm --filter @ambarci/api measure:latency
//
// API bu bilgisayarda çalışır, veritabanı Supabase'te (İrlanda): süre "buradan İrlanda'ya" gidiş-dönüşleri içerir.
// Render (Frankfurt) ölçümü src/scripts/measure-confirm-remote.ts ile, aynı senaryolarla yapılır.
// Sonuç eval/gecikme/yerel-<tarih>.json dosyasına yazılır.
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@ambarci/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import { latencyScenarios, printReport, serverTimingOf, summarize, writeReport } from '../src/scripts/latency.js';
import type { LatencyReport, ScenarioResult } from '../src/scripts/latency.js';
import { createStockFixture, databaseUrl } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

const REPEATS = Number(process.env.MEASURE_REPEATS ?? '20');
const WARMUP = 3;
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/** postgres.js'in gönderdiği sorgulardan BEGIN ile COMMIT arasındakilerin sayısı (ikisi dahil). */
function transactionStatements(queries: string[]): number {
  const begin = queries.findIndex((query) => /^\s*begin\b/i.test(query));
  const commit = queries.findIndex((query) => /^\s*commit\b/i.test(query));
  if (begin < 0 || commit < begin) {
    throw new Error(`BEGIN/COMMIT bulunamadı: ${queries.length} sorgu.`);
  }
  return commit - begin + 1;
}

describe("Onay transaction'ı gecikmesi (yerel)", () => {
  // API'nin bağlantısı, giden her sorguyu kaydeden sürümle değiştirilir.
  const queries: string[] = [];
  const instrumented = createDatabase(databaseUrl(), { maxConnections: 5, onQuery: (query) => queries.push(query) });
  let fx: StockFixture;
  const products: string[] = [];

  beforeAll(async () => {
    fx = await createStockFixture({
      label: 'Gecikme ölçümü',
      overrides: [{ provide: DATABASE, useValue: instrumented.db }],
    });
    for (let index = 1; index <= 5; index += 1) {
      products.push(await fx.addProduct(`OLCUM-${index}`));
    }
  });

  afterAll(async () => {
    await fx?.close();
    await instrumented.close();
  });

  it('senaryoları ölçer ve sonucu kaydeder', async () => {
    const scenarios = latencyScenarios({ products, main: fx.main, branch: fx.branch });
    const [warmup] = scenarios;
    if (!warmup) {
      throw new Error('Senaryo yok.');
    }
    // Isınma: bağlantılar açılsın, ilk istekler ölçüme girmesin.
    for (let index = 0; index < WARMUP; index += 1) {
      await fx.apply(warmup.type, warmup.items);
    }

    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      const transaction: number[] = [];
      const requestTimes: number[] = [];
      let statements: number | undefined;
      for (let index = 0; index < REPEATS; index += 1) {
        const operation = await fx.open(scenario.type, scenario.items);
        queries.length = 0;
        const started = performance.now();
        const response = await fx.confirm(operation).expect(200);
        requestTimes.push(performance.now() - started);
        const serverTime = serverTimingOf(response.headers['server-timing']);
        if (serverTime === null) {
          throw new Error('Server-Timing başlığı yok.');
        }
        transaction.push(serverTime);
        const count = transactionStatements(queries);
        statements ??= count;
        // Her tekrarda aynı sayıda sorgu: transaction'ın yaptığı iş veriden bağımsız.
        expect(count).toBe(statements);
      }
      results.push({
        scenario: scenario.name,
        transaction: summarize(transaction),
        request: summarize(requestTimes),
        statements,
      });
    }

    // Karşılaştırma için yalın gidiş-dönüş: tek bir "select 1".
    const roundTrips: number[] = [];
    for (let index = 0; index < REPEATS; index += 1) {
      const started = performance.now();
      await fx.db.execute(sql`select 1`);
      roundTrips.push(performance.now() - started);
    }

    const report: LatencyReport = {
      label: 'yerel',
      measuredAt: new Date().toISOString(),
      apiUrl: 'bu bilgisayar (Supabase eu-west-1)',
      repeats: REPEATS,
      roundTrip: summarize(roundTrips),
      results,
    };
    printReport(report);
    console.log(`Kaydedildi: ${writeReport(repoRoot, report)}`);

    // Transaction başına sorgu sayısı: BEGIN + işlemi kilitle + kalemler + yetki + birim çevrimi + stok satırlarını
    // aç + kilitle + hareket başına 1 + APPLIED + denetim + outbox + COMMIT. Transaction'a sorgu eklenirse burası
    // değişir ve gecikme hesabı yeniden yapılmalıdır.
    expect(results.map((result) => [result.scenario, result.statements])).toEqual([
      ['1 kalem giriş', 12],
      ['5 kalem giriş', 16],
      ['1 kalem transfer', 13],
    ]);
  });
});
