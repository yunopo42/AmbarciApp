// pnpm eval: asistanın değerlendirme kümesini koşar (#85). Ayrıntılar docs/degerlendirme.md'de.
//
//   pnpm eval                                  geliştirme kümesi (60 mesaj), .env'deki model ve effort
//   pnpm eval --set test                       test kümesi (40 mesaj; yalnızca son ölçümde)
//   pnpm eval --model claude-sonnet-5-5        başka model (fiyatı pricing.ts'de olmalı)
//   pnpm eval --effort medium
//   pnpm eval --only D09,D41                   yalnızca bu mesajlar
//   pnpm eval --label prompt-v3                sonuç dosyasının adına eklenir
//   pnpm eval --list                           mesajları ve beklentileri yazdırır; model çağrılmaz, ücretsiz
//
// GERÇEK model çağrısı yapar ve ücretlidir. API bu bilgisayarda, test uygulaması olarak açılır; veritabanı .env'deki
// Supabase'tir. Koşu geçici bir şirket kurar ve bitince bütün kayıtlarıyla siler. Asıl iş vitest altında çalışır
// (test-db/assistant.quality.ts): Nest uygulaması testlerdeki gibi kurulur.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { describeExpectation, loadCases, selectCases } from './cases.js';
import { parseRunOptions, runOptionsToEnv } from './options.js';

/** apps/api klasörü (dosya dist/scripts/assistant-quality altında çalışır). */
const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));

function main(): void {
  // pnpm bazen seçeneklerin önüne "--" koyar; atlanır.
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
  const { values } = parseArgs({
    args,
    options: {
      set: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      only: { type: 'string' },
      concurrency: { type: 'string' },
      label: { type: 'string' },
      list: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const options = parseRunOptions(values);
  const cases = selectCases(loadCases(), options.set, options.only);

  if (values.list) {
    console.table(
      cases.map((testCase) => ({
        kimlik: testCase.id,
        kategori: testCase.category,
        kanal: testCase.channel,
        hesap: testCase.account,
        mesaj: testCase.turns.join(' ⏎ '),
        beklenen: describeExpectation(testCase.expected),
      })),
    );
    console.log(`${cases.length} mesaj. Model çağrılmadı.`);
    return;
  }

  console.log(`${cases.length} mesaj koşulacak (küme: ${options.set}). Gerçek model çağrısı yapılır ve ücretlidir.`);
  const vitest = path.join(apiRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const child = spawn(process.execPath, [vitest, 'run', '--config', 'vitest.quality.config.ts'], {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, ...runOptionsToEnv(options) },
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

try {
  main();
} catch (error: unknown) {
  console.error(`pnpm eval: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
