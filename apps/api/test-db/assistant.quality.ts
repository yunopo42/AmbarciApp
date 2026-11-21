// Asistanın değerlendirme koşusu (#85). Bu bir test değil, ölçümdür; pnpm test ve pnpm db:test çalıştırmaz.
// pnpm eval (src/scripts/assistant-quality/cli.ts) seçenekleri ortam değişkeniyle verip bu dosyayı çalıştırır.
//
// Her mesaj ayrı bir sohbettir; çok mesajlı örneklerde mesajlar aynı sohbette sırayla gönderilir. Cevaptan sonra
// veritabanından sohbetin açtığı işlemler, model çağrılarının kaydı (ai_runs) ve stok özeti okunur, beklentiyle
// puanlanır (scoring.ts). Sonuç eval/assistant/results/ altına JSON ve Markdown olarak yazılır.
//
// Koşu kalan mesaj yüzünden başarısız olmaz: puan rapordadır. Yalnızca altyapı hatası (veritabanı, API) koşuyu durdurur.
import { afterAll, beforeAll, describe, it } from 'vitest';

import { casesHash, loadCases, selectCases } from '../src/scripts/assistant-quality/cases.js';
import type { QualityCase } from '../src/scripts/assistant-quality/cases.js';
import { runOptionsFromEnv } from '../src/scripts/assistant-quality/options.js';
import { buildReport, printReport, toCaseResult, writeReport } from '../src/scripts/assistant-quality/report.js';
import type { CaseResult } from '../src/scripts/assistant-quality/report.js';
import { scoreCase } from '../src/scripts/assistant-quality/scoring.js';
import type { ObservedTurn } from '../src/scripts/assistant-quality/scoring.js';
import { createQualityEnvironment } from './support/quality-environment.js';
import type { QualityEnvironment } from './support/quality-environment.js';

const options = runOptionsFromEnv(process.env);
const cases = selectCases(loadCases(), options.set, options.only);

async function runCase(env: QualityEnvironment, testCase: QualityCase, baseline: string): Promise<CaseResult> {
  const conversationId = await env.createConversation(testCase.account);
  const answers: ObservedTurn[] = [];
  for (const text of testCase.turns) {
    const turn = await env.send(testCase.account, conversationId, text);
    answers.push(turn);
    if (turn.error) {
      break;
    }
  }
  const operations = await env.operationsOf(conversationId);
  const toolCalls = await env.toolCallsOf(conversationId);
  const stockChanged = (await env.stockSnapshot()) !== baseline;
  const metrics = await env.metricsOf(conversationId);
  const score = scoreCase(testCase, { turns: answers, operations, stockChanged });
  const clientMs = answers.reduce((total, turn) => total + turn.durationMs, 0);
  console.log(
    `${testCase.id} ${score.passed ? 'geçti' : `KALDI (${score.failed.join(', ')})`} · ${(clientMs / 1000).toFixed(1)} sn · ${metrics.rounds} çağrı`,
  );
  return toCaseResult(testCase, score, answers, operations, { ...metrics, clientMs }, toolCalls);
}

/** Mesajları en fazla `limit` tanesi aynı anda koşacak şekilde çalıştırır; sonuçlar kümedeki sırayla döner. */
async function runAll(env: QualityEnvironment, limit: number, baseline: string): Promise<CaseResult[]> {
  const results: CaseResult[] = new Array<CaseResult>(cases.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const index = next;
      next += 1;
      const testCase = cases[index];
      if (testCase) {
        results[index] = await runCase(env, testCase, baseline);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, cases.length) }, () => worker()));
  return results;
}

describe('Asistan değerlendirmesi', () => {
  let env: QualityEnvironment | undefined;

  beforeAll(async () => {
    env = await createQualityEnvironment({ model: options.model, effort: options.effort, prompt: options.prompt });
    console.log(`Geçici şirket kuruldu. Model ${env.model} (${env.effort}), ${cases.length} mesaj, aynı anda ${options.concurrency}.`);
  });

  afterAll(async () => {
    await env?.close();
    console.log('Geçici şirketler bütün kayıtlarıyla silindi.');
  });

  it(`${cases.length} mesajı koşar ve raporu yazar`, async () => {
    if (!env) {
      throw new Error('Ortam kurulamadı.');
    }
    const baseline = await env.stockSnapshot();
    const results = await runAll(env, options.concurrency, baseline);
    const cost = await env.costSummary(results.length);
    const report = buildReport({
      label: options.label,
      set: options.set,
      only: options.only,
      model: env.model,
      effort: env.effort,
      casesHash: casesHash(cases),
      results,
      ...cost,
    });
    printReport(report);
    const files = writeReport(report);
    console.log(`Kaydedildi:\n  ${files.markdown}\n  ${files.json}`);
  });
});
