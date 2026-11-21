// Değerlendirme koşusunun raporu (#85): özet, kategori tablosu ve kalan mesajlar. Sonuç iki dosyaya yazılır:
// eval/assistant/results/<tarih>-<küme>-<model>-<effort>[-etiket].json (her şey) ve aynı adla .md (okumak için).
// Maliyet toplamları SQL'de hesaplanıp metin olarak gelir; burada para ile aritmetik yapılmaz (ADR-003).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { formatDecimal } from '@ambarci/shared';

import { CATEGORY_LABELS, describeExpectation, repoRoot } from './cases.js';
import type { CaseCategory, QualityCase, SetSelection } from './cases.js';
import { CHECK_LABELS } from './scoring.js';
import type { CaseScore, Check, CheckName, ObservedOperation, ObservedTurn } from './scoring.js';

export interface CaseMetrics {
  /** Model çağrısı sayısı (araç turları dahil, bütün mesajlar). */
  rounds: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: string;
  /** Model çağrılarının sunucuda ölçülen toplam süresi (ms). */
  serverMs: number;
  /** Bütün mesajların istemcide ölçülen süresi (ms). */
  clientMs: number;
  tools: string[];
  model: string | null;
  promptVersion: string | null;
}

/** Modelin çağırdığı araç ve girdisi (asistan mesajlarındaki tool_use blokları, sırayla). */
export interface ToolCall {
  name: string;
  input: unknown;
}

export interface CaseResult {
  id: string;
  set: QualityCase['set'];
  category: CaseCategory;
  channel: QualityCase['channel'];
  account: QualityCase['account'];
  turns: string[];
  expected: string;
  /** Beklenen işlem türü; öneri beklenmiyorsa null (karmaşıklık matrisi için). */
  expectedType: string | null;
  passed: boolean;
  failed: CheckName[];
  checks: Check[];
  answers: ObservedTurn[];
  operations: ObservedOperation[];
  /** Hata ayıklama için: bir alan (ör. fire notu) eksikse modelin mi göndermediği, sunucunun mu düşürdüğü buradan görülür. */
  toolCalls: ToolCall[];
  metrics: CaseMetrics;
}

export interface Tally {
  total: number;
  passed: number;
}

export interface QualityReport {
  label: string | null;
  measuredAt: string;
  set: SetSelection;
  only: string[];
  model: string;
  effort: string;
  promptVersion: string | null;
  /** Koşulan mesajların özeti (cases.ts → casesHash). */
  casesHash: string;
  summary: {
    cases: number;
    passed: number;
    accuracyPercent: string;
    /** Güvenlik: bu sayıların hepsi 0 olmalı. */
    stockChanged: number;
    appliedClaims: number;
    unexpectedOperations: number;
    /** Cevabı tamamlanamayan mesajlar (model ya da API hatası). */
    errors: number;
    retries: number;
    /** Yumuşak kontroller (birim korundu, fire nedeni notta): sonucu etkilemez, ayrı sayılır. */
    softChecks: (Tally & { name: CheckName; label: string; failedIds: string[] })[];
    medianClientMs: number | null;
    p90ClientMs: number | null;
    medianRounds: number | null;
    totalCostUsd: string;
    costPerCaseUsd: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  categories: (Tally & { category: CaseCategory; label: string })[];
  channels: (Tally & { channel: QualityCase['channel'] })[];
  accounts: (Tally & { account: QualityCase['account'] })[];
  /** Kontrol bazında doğruluk: bir kontrolün uygulandığı mesajlardan kaçında geçtiği (ör. "Depo", "Ürün ve miktar"). */
  checks: (Tally & { name: CheckName; label: string; soft: boolean })[];
  intent: IntentMatrix;
  results: CaseResult[];
}

/**
 * Niyet (işlem türü) karmaşıklık matrisi: satır beklenen, sütun görülen tür. "Öneri yok" da bir sınıftır: soru,
 * stok sorgusu, kapsam dışı. Kesinlik ve duyarlılık her sınıf için ayrı hesaplanır.
 */
export interface IntentMatrix {
  labels: string[];
  /** matrix[beklenen][görülen] = mesaj sayısı. */
  matrix: number[][];
  classes: { label: string; support: number; precision: string; recall: string; f1: string }[];
}

export const NO_PROPOSAL = 'NONE';
const INTENT_ORDER = ['STOCK_IN', 'STOCK_OUT', 'TRANSFER', 'COUNT', 'WASTE', NO_PROPOSAL];

function intentMatrix(results: CaseResult[]): IntentMatrix {
  const observedOf = (result: CaseResult): string => result.operations.at(-1)?.type ?? NO_PROPOSAL;
  const seen = new Set(results.flatMap((result) => [result.expectedType ?? NO_PROPOSAL, observedOf(result)]));
  const labels = [...INTENT_ORDER.filter((label) => seen.has(label)), ...[...seen].filter((label) => !INTENT_ORDER.includes(label))];
  const matrix = labels.map(() => labels.map(() => 0));
  for (const result of results) {
    const row = matrix[labels.indexOf(result.expectedType ?? NO_PROPOSAL)];
    const column = labels.indexOf(observedOf(result));
    if (row && column >= 0) {
      row[column] = (row[column] ?? 0) + 1;
    }
  }
  const ratio = (part: number, whole: number): string => (whole === 0 ? '—' : (part / whole).toFixed(2));
  const classes = labels.map((label, index) => {
    const truePositive = matrix[index]?.[index] ?? 0;
    const support = (matrix[index] ?? []).reduce((sum, count) => sum + count, 0);
    const predicted = matrix.reduce((sum, row) => sum + (row[index] ?? 0), 0);
    const precision = predicted === 0 ? null : truePositive / predicted;
    const recall = support === 0 ? null : truePositive / support;
    const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
    return {
      label,
      support,
      precision: ratio(truePositive, predicted),
      recall: ratio(truePositive, support),
      f1: f1 === null ? '—' : f1.toFixed(2),
    };
  });
  return { labels, matrix, classes };
}

export function toCaseResult(
  testCase: QualityCase,
  score: CaseScore,
  answers: ObservedTurn[],
  operations: ObservedOperation[],
  metrics: CaseMetrics,
  toolCalls: ToolCall[] = [],
): CaseResult {
  return {
    id: testCase.id,
    set: testCase.set,
    category: testCase.category,
    channel: testCase.channel,
    account: testCase.account,
    turns: testCase.turns,
    expected: describeExpectation(testCase.expected),
    expectedType: testCase.expected.kind === 'proposal' ? testCase.expected.type : null,
    passed: score.passed,
    failed: score.failed,
    checks: score.checks,
    answers,
    operations,
    toolCalls,
    metrics,
  };
}

function percentile(values: number[], fraction: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

function tally<K extends string>(results: CaseResult[], keys: readonly K[], keyOf: (result: CaseResult) => K): (Tally & { key: K })[] {
  return keys
    .map((key) => {
      const group = results.filter((result) => keyOf(result) === key);
      return { key, total: group.length, passed: group.filter((result) => result.passed).length };
    })
    .filter((row) => row.total > 0);
}

const failedCheck = (result: CaseResult, name: CheckName): boolean => result.checks.some((item) => item.name === name && !item.passed);

export interface ReportInput {
  label: string | null;
  set: SetSelection;
  only: string[];
  model: string;
  effort: string;
  casesHash: string;
  results: CaseResult[];
  /** SQL'de toplanmış maliyet (metin). */
  totalCostUsd: string;
  costPerCaseUsd: string;
}

export function buildReport(input: ReportInput): QualityReport {
  const { results } = input;
  const passed = results.filter((result) => result.passed).length;
  const softNames = [...new Set(results.flatMap((result) => result.checks.filter((item) => item.soft).map((item) => item.name)))];
  const sum = (pick: (metrics: CaseMetrics) => number): number => results.reduce((total, result) => total + pick(result.metrics), 0);
  const promptVersions = [...new Set(results.map((result) => result.metrics.promptVersion).filter((value): value is string => value !== null))];

  return {
    label: input.label,
    measuredAt: new Date().toISOString(),
    set: input.set,
    only: input.only,
    model: input.model,
    effort: input.effort,
    promptVersion: promptVersions.join(', ') || null,
    casesHash: input.casesHash,
    summary: {
      cases: results.length,
      passed,
      accuracyPercent: results.length === 0 ? '0.0' : ((passed * 100) / results.length).toFixed(1),
      stockChanged: results.filter((result) => failedCheck(result, 'stockUnchanged')).length,
      appliedClaims: results.filter((result) => failedCheck(result, 'noAppliedClaim')).length,
      unexpectedOperations: results.filter((result) => failedCheck(result, 'noOperation')).length,
      errors: results.filter((result) => failedCheck(result, 'completed')).length,
      retries: results.reduce((total, result) => total + result.answers.reduce((count, turn) => count + turn.retries, 0), 0),
      softChecks: softNames.map((name) => {
        const applied = results.flatMap((result) => result.checks.filter((item) => item.name === name).map((item) => ({ id: result.id, item })));
        return {
          name,
          label: CHECK_LABELS[name],
          total: applied.length,
          passed: applied.filter(({ item }) => item.passed).length,
          failedIds: applied.filter(({ item }) => !item.passed).map(({ id }) => id),
        };
      }),
      medianClientMs: percentile(
        results.map((result) => result.metrics.clientMs),
        0.5,
      ),
      p90ClientMs: percentile(
        results.map((result) => result.metrics.clientMs),
        0.9,
      ),
      medianRounds: percentile(
        results.map((result) => result.metrics.rounds),
        0.5,
      ),
      totalCostUsd: input.totalCostUsd,
      costPerCaseUsd: input.costPerCaseUsd,
      inputTokens: sum((metrics) => metrics.inputTokens),
      outputTokens: sum((metrics) => metrics.outputTokens),
      cacheReadTokens: sum((metrics) => metrics.cacheReadTokens),
    },
    categories: tally(results, Object.keys(CATEGORY_LABELS) as CaseCategory[], (result) => result.category).map(({ key, ...row }) => ({
      category: key,
      label: CATEGORY_LABELS[key],
      ...row,
    })),
    channels: tally(results, ['text', 'voice'] as const, (result) => result.channel).map(({ key, ...row }) => ({ channel: key, ...row })),
    accounts: tally(results, ['employee', 'admin'] as const, (result) => result.account).map(({ key, ...row }) => ({ account: key, ...row })),
    checks: (Object.keys(CHECK_LABELS) as CheckName[])
      .map((name) => {
        const applied = results.flatMap((result) => result.checks.filter((item) => item.name === name));
        return {
          name,
          label: CHECK_LABELS[name],
          soft: applied.some((item) => item.soft === true),
          total: applied.length,
          passed: applied.filter((item) => item.passed).length,
        };
      })
      .filter((row) => row.total > 0),
    intent: intentMatrix(results),
    results,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Biçimlendirme

const CHANNEL_LABELS = { text: 'yazı', voice: 'ses' } as const;
const ACCOUNT_LABELS = { employee: 'çalışan', admin: 'yönetici' } as const;

function percentText(row: Tally): string {
  return row.total === 0 ? '—' : `%${((row.passed * 100) / row.total).toFixed(1).replace('.', ',')}`;
}

function seconds(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} sn`;
}

function operationText(operation: ObservedOperation): string {
  const lines = operation.lines
    .map((line) => {
      const route = line.targetWarehouse ? `${line.warehouse} → ${line.targetWarehouse}` : line.warehouse;
      const said = line.unit ? `${formatDecimal(line.quantity)} ${line.unit} = ${formatDecimal(line.baseQuantity)}` : formatDecimal(line.baseQuantity);
      const cost = line.unitCost ? ` @${formatDecimal(line.unitCost)}` : '';
      return `${line.sku} ${said}${cost} (${route})`;
    })
    .join(' + ');
  const party = operation.party ? `, cari: ${operation.party}` : '';
  const note = operation.note ? `, not: ${operation.note}` : '';
  return `${operation.type} v${operation.version} ${operation.status}${party}${note}: ${lines}`;
}

/** Markdown tablo hücresi: dikey çizgi ve satır sonu tabloyu bozmasın. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

export function reportTitle(report: QualityReport): string {
  return `${report.set === 'all' ? 'Bütün küme' : `${report.set} kümesi`}, ${report.model} (${report.effort})${report.label ? `, ${report.label}` : ''}`;
}

export function reportMarkdown(report: QualityReport): string {
  const { summary } = report;
  const out: string[] = [];
  out.push(`# Değerlendirme: ${reportTitle(report)}`, '');
  out.push(`- Tarih: ${report.measuredAt}`);
  out.push(
    `- Küme: ${report.set}, ${summary.cases} mesaj${report.only.length > 0 ? ` (yalnızca ${report.only.join(', ')})` : ''}; özet ${report.casesHash}`,
  );
  out.push(`- Prompt: ${report.promptVersion ?? '—'}`);
  out.push(`- Sonuç: **${summary.passed}/${summary.cases} geçti (${percentText({ total: summary.cases, passed: summary.passed })})**`);
  out.push(
    `- Güvenlik (hepsi 0 olmalı): stok değişen ${summary.stockChanged}, "yapıldı" diyen ${summary.appliedClaims}, ` +
      `beklenmeyen öneri ${summary.unexpectedOperations}`,
  );
  out.push(`- Tamamlanamayan: ${summary.errors}; geçici hata nedeniyle yeniden gönderme: ${summary.retries}`);
  for (const soft of summary.softChecks) {
    out.push(
      `- ${soft.label} (yumuşak): ${soft.passed}/${soft.total}${soft.failedIds.length > 0 ? `; kalanlar ${soft.failedIds.join(', ')}` : ''}`,
    );
  }
  out.push(
    `- Süre (istemci, mesaj başına): medyan ${seconds(summary.medianClientMs)}, %90 ${seconds(summary.p90ClientMs)}; ` +
      `medyan model çağrısı ${summary.medianRounds ?? '—'}`,
  );
  out.push(
    `- Maliyet: toplam ${summary.totalCostUsd} USD, mesaj başına ${summary.costPerCaseUsd} USD ` +
      `(giriş ${summary.inputTokens}, çıkış ${summary.outputTokens}, önbellekten ${summary.cacheReadTokens} token)`,
  );
  out.push('');

  out.push('## Kategoriler', '', '| Kategori | Geçen | Toplam | Oran |', '| --- | ---: | ---: | ---: |');
  for (const row of report.categories) {
    out.push(`| ${row.label} | ${row.passed} | ${row.total} | ${percentText(row)} |`);
  }
  out.push('', '| Kanal / hesap | Geçen | Toplam | Oran |', '| --- | ---: | ---: | ---: |');
  for (const row of report.channels) {
    out.push(`| ${CHANNEL_LABELS[row.channel]} | ${row.passed} | ${row.total} | ${percentText(row)} |`);
  }
  for (const row of report.accounts) {
    out.push(`| ${ACCOUNT_LABELS[row.account]} | ${row.passed} | ${row.total} | ${percentText(row)} |`);
  }
  out.push('');

  out.push(
    '## Kontroller',
    '',
    'Her kontrol yalnızca ilgili mesajlarda uygulanır (ör. "Depo" yalnızca öneri beklenenlerde). Yumuşak kontrol sonucu etkilemez.',
    '',
    '| Kontrol | Geçen | Uygulanan | Oran |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const row of report.checks) {
    out.push(`| ${row.label}${row.soft ? ' (yumuşak)' : ''} | ${row.passed} | ${row.total} | ${percentText(row)} |`);
  }
  out.push('');

  const intentLabel = (label: string): string => (label === NO_PROPOSAL ? 'öneri yok' : label);
  const { intent } = report;
  out.push('## İşlem türü (niyet)', '', 'Satır beklenen, sütun görülen tür (son öneri).', '');
  out.push(`| Beklenen \\ Görülen | ${intent.labels.map(intentLabel).join(' | ')} |`);
  out.push(`| --- | ${intent.labels.map(() => '---:').join(' | ')} |`);
  intent.labels.forEach((label, index) => {
    out.push(`| ${intentLabel(label)} | ${(intent.matrix[index] ?? []).join(' | ')} |`);
  });
  out.push('', '| Sınıf | Destek | Kesinlik | Duyarlılık | F1 |', '| --- | ---: | ---: | ---: | ---: |');
  for (const row of intent.classes) {
    out.push(`| ${intentLabel(row.label)} | ${row.support} | ${row.precision} | ${row.recall} | ${row.f1} |`);
  }
  out.push('');

  const failed = report.results.filter((result) => !result.passed);
  out.push(`## Kalan mesajlar (${failed.length})`, '');
  if (failed.length === 0) {
    out.push('Yok.', '');
  }
  for (const result of failed) {
    out.push(`### ${result.id}: ${CATEGORY_LABELS[result.category]} (${CHANNEL_LABELS[result.channel]}, ${ACCOUNT_LABELS[result.account]})`, '');
    for (const turn of result.turns) {
      out.push(`> ${turn}`);
    }
    out.push('');
    out.push(`- Beklenen: ${result.expected}`);
    for (const item of result.checks.filter((candidate) => !candidate.passed && !candidate.soft)) {
      out.push(`- Kalan kontrol: ${CHECK_LABELS[item.name]}${item.detail ? ` (${item.detail})` : ''}`);
    }
    for (const operation of result.operations) {
      out.push(`- Görülen öneri: ${operationText(operation)}`);
    }
    out.push(`- Araçlar: ${result.metrics.tools.join(', ') || '—'}`);
    for (const call of result.toolCalls.filter((candidate) => candidate.name.startsWith('propose_'))) {
      out.push(`- Öneri aracının girdisi (${call.name}): \`${cell(JSON.stringify(call.input))}\``);
    }
    result.answers.forEach((answer, index) => {
      const text = answer.error ? `HATA ${answer.error.code}: ${answer.error.message}` : answer.text;
      out.push(`- Cevap${result.answers.length > 1 ? ` ${index + 1}` : ''}: ${cell(text)}`);
    });
    out.push('');
  }

  out.push('## Bütün mesajlar', '', '| Kimlik | Kategori | Sonuç | Kalan | Tur | Süre | Maliyet (USD) |', '| --- | --- | --- | --- | ---: | ---: | ---: |');
  for (const result of report.results) {
    out.push(
      `| ${result.id} | ${CATEGORY_LABELS[result.category]} | ${result.passed ? 'geçti' : '**kaldı**'} | ` +
        `${cell(result.failed.map((name) => CHECK_LABELS[name]).join(', ')) || '—'} | ${result.metrics.rounds} | ` +
        `${seconds(result.metrics.clientMs)} | ${result.metrics.costUsd} |`,
    );
  }
  out.push('');
  return out.join('\n');
}

export function printReport(report: QualityReport): void {
  const { summary } = report;
  console.log(`\nDeğerlendirme: ${reportTitle(report)}`);
  console.table(report.categories.map((row) => ({ kategori: row.label, geçen: row.passed, toplam: row.total, oran: percentText(row) })));
  console.log(`Sonuç: ${summary.passed}/${summary.cases} geçti (${percentText({ total: summary.cases, passed: summary.passed })}).`);
  console.log(
    `Güvenlik: stok değişen ${summary.stockChanged}, "yapıldı" diyen ${summary.appliedClaims}, beklenmeyen öneri ${summary.unexpectedOperations}; ` +
      `tamamlanamayan ${summary.errors}.`,
  );
  console.log(`Süre: medyan ${seconds(summary.medianClientMs)}, %90 ${seconds(summary.p90ClientMs)}. Maliyet: ${summary.totalCostUsd} USD.`);
  const failed = report.results.filter((result) => !result.passed);
  if (failed.length > 0) {
    console.log(`Kalanlar: ${failed.map((result) => `${result.id} (${result.failed.map((name) => CHECK_LABELS[name]).join(', ')})`).join('; ')}`);
  }
}

/** Raporu JSON ve Markdown olarak yazar; dosya yollarını döner. */
export function writeReport(report: QualityReport): { json: string; markdown: string } {
  const directory = path.join(repoRoot, 'eval', 'assistant', 'results');
  mkdirSync(directory, { recursive: true });
  const name = [
    report.measuredAt.slice(0, 10),
    report.set,
    report.model.replace(/^claude-/, ''),
    report.effort,
    ...(report.only.length > 0 ? ['secili'] : []),
    ...(report.label ? [report.label] : []),
  ].join('-');
  const json = path.join(directory, `${name}.json`);
  const markdown = path.join(directory, `${name}.md`);
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdown, `${reportMarkdown(report)}\n`, 'utf8');
  return { json, markdown };
}
