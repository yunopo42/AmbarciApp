// results/*.json dosyalarından sonuç belgesindeki Markdown tablolarını üretir.
//
// Kullanım (depo kökünden): node eval/tool-calling/report.mts [--out <dosya>]

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { PRODUCTS, WAREHOUSES } from './catalog.mts';
import type { ToolCall } from './grade.mts';
import { TEST_CASES, type Category, type Expected, type ExpectedItem } from './messages.mts';
import type { CaseResult, RunFile } from './run.mts';

const CONFIG_ORDER = ['haiku-4-5', 'haiku-5-5-medium', 'haiku-5-5-low'];
const CONFIG_LABELS: Record<string, string> = {
  'haiku-4-5': 'Haiku 4.5',
  'haiku-5-5-medium': 'Haiku 5.5 (medium)',
  'haiku-5-5-low': 'Haiku 5.5 (low)',
};
const CATEGORY_LABELS: Record<Category, string> = {
  sorgu: 'Stok sorgusu',
  giris: 'Giriş',
  cikis: 'Çıkış',
  transfer: 'Transfer',
  belirsiz: 'Belirsiz',
};

function productName(id: string): string {
  return PRODUCTS.find((product) => product.id === id)?.name ?? id;
}

function warehouseName(id: string): string {
  return WAREHOUSES.find((warehouse) => warehouse.id === id)?.name ?? id;
}

function describeItems(items: ExpectedItem[]): string {
  return items
    .map((item) => `${productName(item.product_id)} × ${item.quantity} ${PRODUCTS.find((p) => p.id === item.product_id)?.unit ?? ''}`.trim())
    .join(', ');
}

function describeExpected(expected: Expected): string {
  switch (expected.kind) {
    case 'get_stock':
      return `\`get_stock\`: ${productName(expected.product_id)}, ${expected.warehouse_id ? warehouseName(expected.warehouse_id) : 'depo belirtilmedi'}; öneri yok`;
    case 'propose_stock_in':
      return `\`propose_stock_in\`: ${warehouseName(expected.warehouse_id)}; ${describeItems(expected.items)}${expected.party_contains ? '; cari: Yılmaz Elektrik' : ''}`;
    case 'propose_stock_out':
      return `\`propose_stock_out\`: ${warehouseName(expected.warehouse_id)}; ${describeItems(expected.items)}`;
    case 'propose_transfer':
      return `\`propose_transfer\`: ${warehouseName(expected.from_warehouse_id)} → ${warehouseName(expected.to_warehouse_id)}; ${describeItems(expected.items)}`;
    case 'clarify':
      if (expected.reason === 'aday') return `Öneri yok; adaylarla soru: ${(expected.candidates ?? []).map(productName).join(' / ')}`;
      return `Öneri yok; ${expected.reason === 'depo' ? 'hangi depo' : 'kaç adet'} diye soru`;
  }
}

function describeCalls(calls: ToolCall[]): string {
  const rounds = new Map<number, string[]>();
  for (const call of calls) rounds.set(call.round, [...(rounds.get(call.round) ?? []), `${call.name}${call.isError ? ' (hata)' : ''}`]);
  return [...rounds.values()].map((names) => names.join(' + ')).join(' → ') || '—';
}

function usd(nanoUsd: number, digits: number): string {
  return `${(nanoUsd / 1e9).toFixed(digits).replace('.', ',')} $`;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(2).replace('.', ',');
}

function decimal(value: number, digits: number): string {
  return value.toFixed(digits).replace('.', ',');
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(ratio * sorted.length) - 1)] ?? 0;
}

function mark(ok: boolean): string {
  return ok ? '✓' : '✗';
}

function table(header: string[], rows: string[][]): string {
  const escape = (cell: string): string => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n');
}

function count(cases: CaseResult[], predicate: (result: CaseResult) => boolean): string {
  return `${cases.filter(predicate).length} / ${cases.length}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const resultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  const runs: RunFile[] = [];
  for (const id of CONFIG_ORDER) {
    try {
      runs.push(JSON.parse(await readFile(join(resultsDir, `${id}.json`), 'utf8')) as RunFile);
    } catch {
      // Bu yapılandırma çalıştırılmamış.
    }
  }
  if (runs.length === 0) throw new Error('results/ altında sonuç dosyası yok.');
  const labels = runs.map((run) => CONFIG_LABELS[run.config.id] ?? run.config.id);
  const sections: string[] = [];

  sections.push('### Etiketler\n');
  sections.push(
    table(
      ['#', 'Kategori', 'Mesaj', 'Beklenen ilk araç', 'Beklenen karar ve parametreler'],
      TEST_CASES.map((testCase) => [
        String(testCase.id),
        CATEGORY_LABELS[testCase.category],
        testCase.text,
        `\`search_products\` (sorguda: ${testCase.firstQueryTerms.join(' / ')})`,
        describeExpected(testCase.expected),
      ]),
    ),
  );

  sections.push('\n### Özet oranlar\n');
  const categories = Object.keys(CATEGORY_LABELS) as Category[];
  sections.push(
    table(
      ['Ölçüm', ...labels],
      [
        ['İlk araç doğru', ...runs.map((run) => count(run.cases, (r) => r.grade.firstTool))],
        ['Doğru araç', ...runs.map((run) => count(run.cases, (r) => r.grade.tool))],
        ['Doğru parametre / doğru soru', ...runs.map((run) => count(run.cases, (r) => r.grade.params))],
        ...categories.map((category) => [
          `${CATEGORY_LABELS[category]}: araç ve parametre doğru`,
          ...runs.map((run) => count(run.cases.filter((r) => r.category === category), (r) => r.grade.tool && r.grade.params)),
        ]),
        ['Belirsiz mesajda öneri aracı çağrısı', ...runs.map((run) => String(run.cases.filter((r) => r.category === 'belirsiz' && !r.grade.tool).length))],
        [
          '`note` alanı doldurulan öneri',
          ...runs.map((run) => {
            const proposals = run.cases.flatMap((r) => r.calls.filter((c) => c.name.startsWith('propose_')).map((c) => ({ id: r.id, note: c.input.note })));
            const withNote = proposals.filter((p) => typeof p.note === 'string' && p.note.trim() !== '');
            return `${withNote.length} / ${proposals.length}${withNote.length ? ` (#${withNote.map((p) => p.id).join(', #')})` : ''}`;
          }),
        ],
        ['Tur sınırına (5) takılan', ...runs.map((run) => String(run.cases.filter((r) => r.roundLimitHit).length))],
        ['Hatalı araç sonucu dönen çağrı', ...runs.map((run) => String(run.cases.reduce((sum, r) => sum + r.calls.filter((c) => c.isError).length, 0)))],
        ['Ortalama araç turu / mesaj', ...runs.map((run) => decimal(run.cases.reduce((sum, r) => sum + r.toolRounds, 0) / run.cases.length, 2))],
        ['İstek hatası', ...runs.map((run) => String(run.cases.filter((r) => r.error).length))],
        ['Yeniden denenen istek', ...runs.map((run) => String(run.cases.reduce((sum, r) => sum + r.retries, 0)))],
      ],
    ),
  );

  sections.push('\n### Token, süre ve maliyet\n');
  sections.push(
    table(
      ['Ölçüm (20 mesaj)', ...labels],
      [
        ['Model çağrısı', ...runs.map((run) => String(run.cases.reduce((sum, r) => sum + r.apiCalls, 0)))],
        ['Giriş token (toplam)', ...runs.map((run) => String(run.cases.reduce((sum, r) => sum + r.usage.input_tokens, 0)))],
        ['Çıkış token (toplam)', ...runs.map((run) => String(run.cases.reduce((sum, r) => sum + r.usage.output_tokens, 0)))],
        ['Giriş token / mesaj (ort.)', ...runs.map((run) => decimal(run.cases.reduce((sum, r) => sum + r.usage.input_tokens, 0) / run.cases.length, 0))],
        ['Çıkış token / mesaj (ort.)', ...runs.map((run) => decimal(run.cases.reduce((sum, r) => sum + r.usage.output_tokens, 0) / run.cases.length, 0))],
        ['En büyük tek istem (giriş token)', ...runs.map((run) => String(Math.max(...run.cases.map((r) => r.maxInputTokensPerCall))))],
        ['Süre / mesaj, medyan (sn)', ...runs.map((run) => seconds(percentile(run.cases.map((r) => r.latencyMs), 0.5)))],
        ['Süre / mesaj, ortalama (sn)', ...runs.map((run) => seconds(run.cases.reduce((sum, r) => sum + r.latencyMs, 0) / run.cases.length))],
        ['Süre / mesaj, p90 (sn)', ...runs.map((run) => seconds(percentile(run.cases.map((r) => r.latencyMs), 0.9)))],
        ['Süre / model çağrısı, medyan (sn)', ...runs.map((run) => seconds(percentile(run.cases.flatMap((r) => r.callLatenciesMs), 0.5)))],
        ['Maliyet (toplam)', ...runs.map((run) => usd(run.cases.reduce((sum, r) => sum + r.costNanoUsd, 0), 4))],
        ['Maliyet / mesaj (ort.)', ...runs.map((run) => usd(run.cases.reduce((sum, r) => sum + r.costNanoUsd, 0) / run.cases.length, 5))],
        ['1000 mesaj için hesaplanan maliyet', ...runs.map((run) => usd((run.cases.reduce((sum, r) => sum + r.costNanoUsd, 0) / run.cases.length) * 1000, 2))],
        ['Isınma isteği maliyeti (ölçüme dahil değil)', ...runs.map((run) => usd(run.warmup.costNanoUsd, 4))],
      ],
    ),
  );

  sections.push('\n### Mesaj bazında doğruluk\n');
  sections.push('Her hücre sırasıyla ilk araç, doğru araç ve doğru parametre / soru sonucudur.\n');
  sections.push(
    table(
      ['#', 'Kategori', ...labels],
      TEST_CASES.map((testCase) => [
        String(testCase.id),
        CATEGORY_LABELS[testCase.category],
        ...runs.map((run) => {
          const result = run.cases.find((r) => r.id === testCase.id);
          return result ? `${mark(result.grade.firstTool)} ${mark(result.grade.tool)} ${mark(result.grade.params)}` : '—';
        }),
      ]),
    ),
  );

  for (const [index, run] of runs.entries()) {
    sections.push(`\n### ${labels[index]}: mesaj bazında ayrıntı\n`);
    sections.push(
      table(
        ['#', 'Çağrılan araçlar (turlar →)', 'İlk', 'Araç', 'Param.', 'Giriş tok.', 'Çıkış tok.', 'Süre (sn)', 'Maliyet'],
        run.cases.map((r) => [
          String(r.id),
          describeCalls(r.calls) + (r.roundLimitHit ? ' (tur sınırı)' : '') + (r.error ? ` (hata: ${r.error})` : ''),
          mark(r.grade.firstTool),
          mark(r.grade.tool),
          mark(r.grade.params),
          String(r.usage.input_tokens),
          String(r.usage.output_tokens),
          seconds(r.latencyMs),
          usd(r.costNanoUsd, 5),
        ]),
      ),
    );
  }

  sections.push('\n### Yanlış sonuçların notları\n');
  for (const [index, run] of runs.entries()) {
    const failures = run.cases.filter((r) => !(r.grade.firstTool && r.grade.tool && r.grade.params));
    sections.push(`**${labels[index]}:** ${failures.length === 0 ? 'yok.' : ''}\n`);
    for (const r of failures) {
      sections.push(`- #${r.id}: ${r.grade.notes.join('; ') || '—'}. Son cevap: "${r.finalText.replace(/\s+/g, ' ').slice(0, 300)}"`);
    }
    sections.push('');
  }

  const output = `${sections.join('\n')}\n`;
  if (values.out) await writeFile(values.out, output, 'utf8');
  else process.stdout.write(output);
}

await main();
