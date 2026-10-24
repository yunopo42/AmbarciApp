// Onay transaction'ı gecikme ölçümünün ortak parçaları (#34): senaryolar, özet istatistik ve sonuç dosyası.
// Yerel ölçüm (test-db/latency.measure.ts) ve Render ölçümü (measure-confirm-remote.ts) aynı senaryoları kullanır.
// Buradaki sayılar süre (ms) olduğu için JS number ile hesaplanır; miktar ve para hesabı yapılmaz.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// interface değil type: istek gövdesi olarak Record<string, unknown> beklenen yerlere verilebilsin.
export type LatencyItem = {
  productId: string;
  warehouseId: string;
  targetWarehouseId?: string;
  quantity: string;
  unitCost?: string;
};

export interface LatencyScenario {
  name: string;
  type: 'STOCK_IN' | 'TRANSFER';
  items: LatencyItem[];
}

/**
 * Ölçülen senaryolar. Hepsi stoğu artırır ya da yalnızca depolar arasında taşır; bu yüzden tekrarlar yetersiz stoğa
 * düşmez. Transfer, giriş senaryolarının bıraktığı stoktan yapılır.
 */
export function latencyScenarios(ids: { products: string[]; main: string; branch: string }): LatencyScenario[] {
  const [first] = ids.products;
  if (!first || ids.products.length < 5) {
    throw new Error('Ölçüm için en az 5 ürün gerekir.');
  }
  return [
    { name: '1 kalem giriş', type: 'STOCK_IN', items: [{ productId: first, warehouseId: ids.main, quantity: '10', unitCost: '5' }] },
    {
      name: '5 kalem giriş',
      type: 'STOCK_IN',
      items: ids.products.slice(0, 5).map((productId) => ({ productId, warehouseId: ids.main, quantity: '10', unitCost: '5' })),
    },
    {
      name: '1 kalem transfer',
      type: 'TRANSFER',
      items: [{ productId: first, warehouseId: ids.main, targetWarehouseId: ids.branch, quantity: '1' }],
    },
  ];
}

export interface Summary {
  n: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

/** Medyan ve p95 (en yakın sıra yöntemi: değerlerin %95'i bu değere eşit ya da küçük). */
export function summarize(values: number[]): Summary {
  if (values.length === 0) {
    throw new Error('Özetlenecek ölçüm yok.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? Number.NaN;
  const middle = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[Math.floor(middle)] ?? Number.NaN);
  return {
    n: sorted.length,
    median: round(median),
    p95: round(at(0.95)),
    min: round(sorted[0] ?? Number.NaN),
    max: round(sorted[sorted.length - 1] ?? Number.NaN),
  };
}

/** "db;dur=182.4;desc=..." başlığından süreyi (ms) okur. */
export function serverTimingOf(header: string | undefined): number | null {
  const match = header?.match(/(?:^|,)\s*db;dur=([\d.]+)/);
  return match?.[1] ? Number(match[1]) : null;
}

export interface ScenarioResult {
  scenario: string;
  /** Sunucudaki onay transaction'ı süresi (Server-Timing). */
  transaction: Summary;
  /** İstemcinin gördüğü onay isteği süresi (ağ dahil). */
  request: Summary;
  /** Transaction içindeki SQL ifadesi sayısı (BEGIN ve COMMIT dahil); yalnızca yerel ölçümde sayılır. */
  statements?: number;
}

export interface LatencyReport {
  label: string;
  measuredAt: string;
  apiUrl: string;
  repeats: number;
  /** Yalın gidiş-dönüş (select 1), yalnızca yerel ölçümde. */
  roundTrip?: Summary;
  results: ScenarioResult[];
}

export function printReport(report: LatencyReport): void {
  console.log(`\nOnay transaction'ı gecikmesi: ${report.label} (${report.apiUrl}), ${report.repeats} tekrar`);
  if (report.roundTrip) {
    console.log(`Yalın gidiş-dönüş (select 1): medyan ${report.roundTrip.median} ms, p95 ${report.roundTrip.p95} ms`);
  }
  console.table(
    report.results.map((result) => ({
      senaryo: result.scenario,
      'sorgu sayısı': result.statements ?? '—',
      'transaction medyan (ms)': result.transaction.median,
      'transaction p95 (ms)': result.transaction.p95,
      'istek medyan (ms)': result.request.median,
      'istek p95 (ms)': result.request.p95,
    })),
  );
}

/** Sonucu eval/gecikme/<etiket>-<tarih>.json dosyasına yazar ve yolunu döner. */
export function writeReport(repoRoot: string, report: LatencyReport): string {
  const directory = path.join(repoRoot, 'eval', 'gecikme');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${report.label}-${report.measuredAt.slice(0, 10)}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
