// Araç çağırma denemesi: 20 etiketli saha mesajını Claude modelleriyle çalıştırır.
//
// Kullanım (depo kökünden):
//   node --env-file=<.env yolu> eval/tool-calling/run.mts [--configs haiku-4-5,haiku-5-5-low] [--only 1,16]
//
// ANTHROPIC_API_KEY ortam değişkeninden okunur ve hiçbir yere yazdırılmaz.
// Tam koşu sonuçları eval/tool-calling/results/<config>.json dosyasına yazılır; --only ile
// yapılan kısmi koşu yalnızca ekrana yazar.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runTool } from './catalog.mts';
import { grade, type Grade, type ToolCall } from './grade.mts';
import { TEST_CASES, type Category } from './messages.mts';
import { PROMPT_VERSION, SYSTEM_PROMPT, TOOLS } from './tools.mts';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 5;
const MAX_RETRIES = 4;
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const WARMUP_TEXT = 'Hangi depolar var?';

interface Price {
  // Token başına nano-dolar (1e-9 USD). Maliyet tamsayıyla hesaplanır, yalnızca gösterirken dolara çevrilir.
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface RunConfig {
  id: string;
  model: string;
  effort?: 'low' | 'medium';
  price: Price;
}

// Fiyatlar claude-api skill'indeki model tablosundan (önbellek tarihi 2026-10-06).
// Haiku 4.5: 1 $ / 5 $; Haiku 5.5 (100K token altı istem): 0,10 $ / 0,50 $ (milyon token başına).
// Önbellek yazma girişin 1,25 katı, okuma 0,1 katı; bu denemede önbellek kullanılmıyor.
const CONFIGS: RunConfig[] = [
  { id: 'haiku-4-5', model: 'claude-haiku-4-5', price: { input: 1000, output: 5000, cacheWrite: 1250, cacheRead: 100 } },
  { id: 'haiku-5-5-medium', model: 'claude-haiku-5-5', effort: 'medium', price: { input: 100, output: 500, cacheWrite: 125, cacheRead: 10 } },
  { id: 'haiku-5-5-low', model: 'claude-haiku-5-5', effort: 'low', price: { input: 100, output: 500, cacheWrite: 125, cacheRead: 10 } },
];

interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

interface MessageParam {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

interface MessageResponse {
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  usage: Partial<Record<keyof Usage, number | null>>;
}

interface Conversation {
  calls: ToolCall[];
  finalText: string;
  stopReason: string;
  toolRounds: number;
  apiCalls: number;
  roundLimitHit: boolean;
  usage: Usage;
  costNanoUsd: number;
  latencyMs: number;
  callLatenciesMs: number[];
  maxInputTokensPerCall: number;
  retries: number;
  servedModels: string[];
}

export interface CaseResult extends Conversation {
  id: number;
  category: Category;
  text: string;
  grade: Grade;
  error?: string;
}

export interface RunFile {
  config: { id: string; model: string; effort: string | null };
  promptVersion: string;
  maxTokens: number;
  maxToolRounds: number;
  pricesNanoUsdPerToken: Price;
  startedAt: string;
  finishedAt: string;
  warmup: Conversation;
  cases: CaseResult[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createMessage(apiKey: string, body: unknown): Promise<{ response: MessageResponse; latencyMs: number; retries: number }> {
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= MAX_RETRIES) throw error;
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (res.ok) {
      const response = (await res.json()) as MessageResponse;
      return { response, latencyMs: performance.now() - started, retries: attempt };
    }
    const errorBody = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= MAX_RETRIES) {
      throw new Error(`API ${res.status}: ${errorBody.slice(0, 500)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
  }
}

function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

function costOf(usage: Usage, price: Price): number {
  return (
    usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_creation_input_tokens * price.cacheWrite +
    usage.cache_read_input_tokens * price.cacheRead
  );
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => String(block.text ?? ''))
    .join('\n')
    .trim();
}

async function converse(apiKey: string, config: RunConfig, userText: string): Promise<Conversation> {
  const messages: MessageParam[] = [{ role: 'user', content: userText }];
  const calls: ToolCall[] = [];
  const usage = emptyUsage();
  const callLatenciesMs: number[] = [];
  const servedModels = new Set<string>();
  let operationNo = 0;
  const context = { nextOperationId: (): string => `op-${++operationNo}` };
  let toolRounds = 0;
  let retries = 0;
  let maxInputTokensPerCall = 0;
  let finalText = '';
  let stopReason = '';
  let roundLimitHit = false;

  for (;;) {
    const body = {
      model: config.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      ...(config.effort ? { output_config: { effort: config.effort } } : {}),
    };
    const { response, latencyMs, retries: callRetries } = await createMessage(apiKey, body);
    callLatenciesMs.push(latencyMs);
    retries += callRetries;
    servedModels.add(response.model);
    for (const key of Object.keys(usage) as (keyof Usage)[]) usage[key] += response.usage[key] ?? 0;
    maxInputTokensPerCall = Math.max(maxInputTokensPerCall, response.usage.input_tokens ?? 0);
    stopReason = response.stop_reason ?? '';
    finalText = textOf(response.content);
    // Düşünme blokları dahil içerik olduğu gibi geri gönderilir.
    messages.push({ role: 'assistant', content: response.content });

    if (stopReason !== 'tool_use') break;
    if (toolRounds >= MAX_TOOL_ROUNDS) {
      roundLimitHit = true;
      break;
    }
    toolRounds++;
    const results: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const name = String(block.name);
      const input = (block.input ?? {}) as Record<string, unknown>;
      const outcome = runTool(name, input, context);
      calls.push({ round: toolRounds, name, input, isError: outcome.isError });
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(outcome.content),
        ...(outcome.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: 'user', content: results });
  }

  return {
    calls,
    finalText,
    stopReason,
    toolRounds,
    apiCalls: callLatenciesMs.length,
    roundLimitHit,
    usage,
    costNanoUsd: costOf(usage, config.price),
    latencyMs: callLatenciesMs.reduce((sum, ms) => sum + ms, 0),
    callLatenciesMs,
    maxInputTokensPerCall,
    retries,
    servedModels: [...servedModels],
  };
}

function mark(ok: boolean): string {
  return ok ? '✓' : '✗';
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { configs: { type: 'string' }, only: { type: 'string' } } });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY tanımlı değil. node --env-file=<.env yolu> ile çalıştırın.');

  const configIds = values.configs?.split(',') ?? CONFIGS.map((config) => config.id);
  const configs = configIds.map((id) => {
    const config = CONFIGS.find((candidate) => candidate.id === id);
    if (!config) throw new Error(`Bilinmeyen yapılandırma: ${id}`);
    return config;
  });
  const onlyIds = values.only?.split(',').map(Number);
  const cases = onlyIds ? TEST_CASES.filter((testCase) => onlyIds.includes(testCase.id)) : TEST_CASES;
  const isFullRun = !onlyIds;

  const startedAt = new Date().toISOString();
  const runs = new Map<string, { warmup: Conversation; cases: CaseResult[] }>();

  // İlk istekte strict şemalar derlendiği için her yapılandırma önce ölçüm dışı bir ısınma isteği atar.
  for (const config of configs) {
    const warmup = await converse(apiKey, config, WARMUP_TEXT);
    console.log(`[${config.id}] ısınma: ${(warmup.latencyMs / 1000).toFixed(1)} sn, model ${warmup.servedModels.join(', ')}`);
    runs.set(config.id, { warmup, cases: [] });
  }

  // Mesajlar yapılandırmalar arasında sırayla çalıştırılır; böylece API yükündeki dalgalanma
  // süreleri tek bir modelin aleyhine çarpıtmaz.
  for (const testCase of cases) {
    for (const config of configs) {
      let result: CaseResult;
      try {
        const conversation = await converse(apiKey, config, testCase.text);
        result = {
          id: testCase.id,
          category: testCase.category,
          text: testCase.text,
          ...conversation,
          grade: grade(testCase, conversation.calls, conversation.finalText),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          id: testCase.id,
          category: testCase.category,
          text: testCase.text,
          calls: [],
          finalText: '',
          stopReason: 'error',
          toolRounds: 0,
          apiCalls: 0,
          roundLimitHit: false,
          usage: emptyUsage(),
          costNanoUsd: 0,
          latencyMs: 0,
          callLatenciesMs: [],
          maxInputTokensPerCall: 0,
          retries: 0,
          servedModels: [],
          grade: { firstTool: false, tool: false, params: false, notes: ['istek hatası'] },
          error: message,
        };
      }
      runs.get(config.id)?.cases.push(result);
      const { firstTool, tool, params } = result.grade;
      console.log(
        `[${config.id}] #${String(testCase.id).padStart(2, '0')} ilk${mark(firstTool)} araç${mark(tool)} param${mark(params)} ` +
          `tur=${result.toolRounds} ${(result.latencyMs / 1000).toFixed(1)} sn ` +
          `${result.calls.map((call) => call.name).join(' → ') || '-'}${result.error ? ` HATA: ${result.error}` : ''}`,
      );
    }
  }

  if (!isFullRun) return;
  const finishedAt = new Date().toISOString();
  const resultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
  await mkdir(resultsDir, { recursive: true });
  for (const config of configs) {
    const run = runs.get(config.id);
    if (!run) continue;
    const file: RunFile = {
      config: { id: config.id, model: config.model, effort: config.effort ?? null },
      promptVersion: PROMPT_VERSION,
      maxTokens: MAX_TOKENS,
      maxToolRounds: MAX_TOOL_ROUNDS,
      pricesNanoUsdPerToken: config.price,
      startedAt,
      finishedAt,
      warmup: run.warmup,
      cases: run.cases,
    };
    await writeFile(join(resultsDir, `${config.id}.json`), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
  console.log(`Sonuçlar ${resultsDir} klasörüne yazıldı.`);
}

await main();
