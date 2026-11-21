// Kaydedilmiş bir koşuyu model çağırmadan yeniden puanlar (#86). Puanlama kuralı değişince (ör. bir kelime listesi
// genişleyince) eski koşular yeni kuralla aynı ölçüte getirilir; cevaplar, öneriler ve ölçümler aynı kalır.
// Yalnızca aynı kümeyle koşulmuş rapor yeniden puanlanabilir: mesajlar değiştiyse eski cevaplar yeni beklentiye ait
// değildir, sonuç anlamsız olur.
import { readFileSync } from 'node:fs';

import { casesHash, selectCases } from './cases.js';
import type { QualityCase } from './cases.js';
import { buildReport, toCaseResult } from './report.js';
import type { QualityReport } from './report.js';
import { scoreCase } from './scoring.js';

export function readReport(file: string): QualityReport {
  return JSON.parse(readFileSync(file, 'utf8')) as QualityReport;
}

/** Raporu güncel puanlamayla yeniden kurar. Kümenin özeti rapordakiyle aynı değilse hata verir. */
export function rescoreReport(report: QualityReport, cases: QualityCase[], label: string): QualityReport {
  const selected = selectCases(cases, report.set, report.only);
  const hash = casesHash(selected);
  if (hash !== report.casesHash) {
    throw new Error(
      `Raporun kümesi (${report.casesHash}) güncel kümeyle (${hash}) aynı değil: mesajlar değişmiş, yeniden puanlanamaz.`,
    );
  }
  const byId = new Map(selected.map((testCase) => [testCase.id, testCase]));
  const results = report.results.map((result) => {
    const testCase = byId.get(result.id);
    if (!testCase) {
      throw new Error(`${result.id} güncel kümede yok.`);
    }
    // Stok kontrolü koşu anında yapılmıştı; sonucu eski kayıttan okunur.
    const stockChanged = result.checks.some((item) => item.name === 'stockUnchanged' && !item.passed);
    const score = scoreCase(testCase, { turns: result.answers, operations: result.operations, stockChanged });
    return toCaseResult(testCase, score, result.answers, result.operations, result.metrics, result.toolCalls);
  });
  const rebuilt = buildReport({
    label: [report.label, label].filter((part): part is string => Boolean(part)).join('-'),
    set: report.set,
    only: report.only,
    model: report.model,
    effort: report.effort,
    casesHash: report.casesHash,
    results,
    totalCostUsd: report.summary.totalCostUsd,
    costPerCaseUsd: report.summary.costPerCaseUsd,
  });
  // Koşunun tarihi korunur: yeniden puanlama yeni bir ölçüm değildir.
  return { ...rebuilt, measuredAt: report.measuredAt };
}
