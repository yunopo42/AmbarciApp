// Sohbet cevabının çalışan bir API'deki (varsayılan: Render, Frankfurt) akışını ve maliyetini ölçer (#60):
//   pnpm measure:chat
//
// Kendi bilgisayarında çalışır ve GERÇEK model çağrısı yapar (2. haftada soru başına ortalama 0,0004 dolar).
//  1. Ölçüm kullanıcısıyla Supabase'e giriş yapar ve uyuyan API'yi uyandırır.
//  2. API üzerinden geçici bir şirket kurar: iki depo, altı ürün (alternatif adlar ve ek birimlerle), onaylanmış giriş
//     ve çıkış işlemleri. Stok, uygulamadaki gibi işlem onayıyla oluşur.
//  3. Sabit soru listesini sırayla sorar; her soru ayrı bir sohbettir. Her SSE olayının istemciye geliş zamanını,
//     `: ping` satırlarını ve son cevabı kaydeder.
//  4. Stok değiştirme isteğinden sonra stoğun değişmediğini API'den doğrular (asistan stoğa yazamaz).
//  5. Veritabanından bu soruların ai_runs kayıtlarını okur: tur, süre, ilk metin parçası, token, önbellek, maliyet.
//  6. Sonucu eval/sohbet/<etiket>-<tarih>.json dosyasına yazar, özeti yazdırır ve geçici şirketi bütün kayıtlarıyla
//     (sohbetler ve ai_runs dahil) siler.
//
// Gerekenler (.env): DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, MEASURE_EMAIL, MEASURE_PASSWORD.
// İsteğe bağlı: MEASURE_API_URL (varsayılan Render adresi), MEASURE_LABEL.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createDatabase } from '@ambarci/db';
import type { Database } from '@ambarci/db';
import { chatStreamEventSchema, formatDecimal, IDEMPOTENCY_HEADER, ORGANIZATION_HEADER, productStockSchema } from '@ambarci/shared';
import type { ChatStreamEvent } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { loadRepoEnv, measureApiUrl, repoRoot, required, signIn, wakeUp } from './remote-session.js';

loadRepoEnv();

const apiUrl = measureApiUrl();
const label = process.env.MEASURE_LABEL?.trim() || (apiUrl.includes('onrender.com') ? 'render' : 'yerel');

// ---------------------------------------------------------------------------------------------------------------
// Geçici şirketin kataloğu ve stoğu. Miktarlar ana birimde; beklenen cevaplar bu tabloya göre yazıldı.

interface FixtureProduct {
  key: string;
  sku: string;
  name: string;
  baseUnit: string;
  minStock: string;
  units: { unit: string; factor: string }[];
  aliases: string[];
  /** Girişle oluşan stok: [Merkez, Ostim]. */
  stockIn: [string, string];
}

const PRODUCTS: FixtureProduct[] = [
  {
    key: 'nym',
    sku: 'OLC-NYM-325',
    name: 'NYM kablo 3x2,5 mm²',
    baseUnit: 'metre',
    minStock: '300',
    units: [{ unit: 'makara', factor: '100' }],
    aliases: ['nym 2,5', '3x2,5 kablo'],
    stockIn: ['1300', '350'],
  },
  {
    key: 'kar',
    sku: 'OLC-KAR-40',
    name: 'Kaçak akım rölesi 2 kutup 40 A 30 mA',
    baseUnit: 'adet',
    minStock: '6',
    units: [{ unit: 'kutu', factor: '6' }],
    aliases: ['kaçak akım', 'kaçak akım rölesi'],
    stockIn: ['4', '0'],
  },
  {
    key: 'priz',
    sku: 'OLC-PRZ-3',
    name: 'Üçlü grup priz, 1,5 m kablolu',
    baseUnit: 'adet',
    minStock: '20',
    units: [{ unit: 'koli', factor: '20' }],
    aliases: ['üçlü priz', 'grup priz'],
    stockIn: ['120', '40'],
  },
  {
    key: 'panel',
    sku: 'OLC-PNL-60',
    name: 'LED panel 60x60 40 W',
    baseUnit: 'adet',
    minStock: '8',
    units: [{ unit: 'koli', factor: '4' }],
    aliases: ['60x60 panel', 'panel led'],
    stockIn: ['32', '8'],
  },
  {
    key: 'ampul',
    sku: 'OLC-AMP-9',
    name: 'LED ampul 9 W E27',
    baseUnit: 'adet',
    minStock: '100',
    units: [{ unit: 'koli', factor: '100' }],
    aliases: ['ampul', 'led ampul'],
    stockIn: ['500', '0'],
  },
  {
    key: 'sigorta',
    sku: 'OLC-SGR-16',
    name: 'Otomatik sigorta C16 1 kutup',
    baseUnit: 'adet',
    minStock: '24',
    units: [{ unit: 'kutu', factor: '12' }],
    aliases: ['otomat', '16 amper sigorta'],
    stockIn: ['60', '24'],
  },
];

/** Girişten sonra Merkez'den yapılan çıkış: NYM 3x2,5'in son hareketlerinde görünür (1.300 − 100 = 1.200). */
const NYM_OUT = '100';

// ---------------------------------------------------------------------------------------------------------------
// Sorular. `expect`: her grubun en az bir ifadesi cevapta geçmeli (büyük-küçük harf ve Türkçe harf farkı yok sayılır).
// Bu otomatik kontrol kabaca bir süzgeçtir; cevapların tamamı rapora yazılır ve elle okunur.

interface Question {
  id: string;
  /** Ne ölçülüyor. */
  purpose: string;
  text: string;
  expect: string[][];
}

const QUESTIONS: Question[] = [
  {
    id: 'tek-depo',
    purpose: 'Tek ürün, tek depo',
    text: 'Merkez depoda NYM 3x2,5 kablo kaç metre var?',
    expect: [['1.200', '1200'], ['metre']],
  },
  {
    id: 'alternatif-ad',
    purpose: 'Alternatif adla arama',
    text: "Ostim'de üçlü priz kaç tane var?",
    expect: [['40']],
  },
  {
    id: 'toplam',
    purpose: 'İki deponun toplamı (toplamı araç verir)',
    text: '60x60 panel iki depoda toplam kaç adet?',
    expect: [['40']],
  },
  {
    id: 'kritik',
    purpose: 'Kritik stok',
    text: 'Kaçak akım rölesi kritik seviyenin altında mı?',
    expect: [['4'], ['6'], ['altında', 'kritik']],
  },
  {
    id: 'hareket',
    purpose: 'Son hareketler',
    text: 'NYM 3x2,5 kablonun son hareketleri neler?',
    expect: [['100'], ['çıkış']],
  },
  {
    id: 'belirsiz',
    purpose: 'Birden fazla aday',
    text: 'Elimizde hangi LED ürünler var?',
    expect: [['panel'], ['ampul']],
  },
  {
    id: 'bulunamadi',
    purpose: 'Katalogda olmayan ürün',
    text: 'Depoda trafo var mı?',
    expect: [['bulunamadı', 'bulamadım', 'yok', 'kayıtlı değil', 'bulunmuyor']],
  },
  {
    id: 'yazma-reddi',
    purpose: 'Stok değiştirme isteği reddedilir, stok değişmez',
    text: 'Merkezden 5 adet otomat çıkışı yap.',
    expect: [['yapılamıyor', 'yapamıyorum', 'yapamam', 'değiştiremiyorum', 'değiştiremem', 'henüz', 'mümkün değil']],
  },
  {
    id: 'uzun',
    purpose: 'Çok araçlı uzun cevap (15 saniyelik ping aralığını aşması beklenir)',
    text:
      'NYM 3x2,5 kablo, üçlü priz, 60x60 panel, kaçak akım rölesi, LED ampul ve C16 sigortanın Merkez ve Ostim ' +
      'depolarındaki stoklarını ve her birinin son hareketlerini ürün ürün ayrı ayrı yaz.',
    expect: [['1.200', '1200'], ['kaçak akım']],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// HTTP yardımcıları

const idSchema = z.object({ id: z.uuid() });
const operationSchema = z.object({ id: z.uuid(), version: z.number().int() });

interface Session {
  token: string;
  organizationId: string | null;
}

function headers(session: Session, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
    ...(session.organizationId ? { [ORGANIZATION_HEADER]: session.organizationId } : {}),
    ...extra,
  };
}

async function post<T>(session: Session, route: string, body: unknown, schema: z.ZodType<T>, extra?: Record<string, string>): Promise<T> {
  const response = await fetch(`${apiUrl}${route}`, { method: 'POST', headers: headers(session, extra), body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`POST ${route} başarısız (${response.status}): ${await response.text()}`);
  }
  return schema.parse(await response.json());
}

async function get<T>(session: Session, route: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${apiUrl}${route}`, { headers: headers(session) });
  if (!response.ok) {
    throw new Error(`GET ${route} başarısız (${response.status}): ${await response.text()}`);
  }
  return schema.parse(await response.json());
}

/** İşlemi açar ve onaylar: stok yalnızca onay uç noktasıyla değişir. */
async function applyOperation(session: Session, body: Record<string, unknown>): Promise<void> {
  const operation = await post(session, '/v1/operations', body, operationSchema);
  await post(session, `/v1/operations/${operation.id}/confirm`, { version: operation.version }, z.unknown(), {
    [IDEMPOTENCY_HEADER]: randomUUID(),
  });
}

interface Fixture {
  organizationId: string;
  warehouses: { main: string; branch: string };
  products: Record<string, string>;
}

async function createFixture(session: Session): Promise<Fixture> {
  const organization = await post(session, '/v1/organizations', { name: `Sohbet ölçümü ${randomUUID().slice(0, 8)}` }, idSchema);
  session.organizationId = organization.id;
  const main = await post(session, '/v1/warehouses', { name: 'Merkez Depo' }, idSchema);
  const branch = await post(session, '/v1/warehouses', { name: 'Ostim Depo' }, idSchema);

  const products: Record<string, string> = {};
  for (const product of PRODUCTS) {
    const created = await post(
      session,
      '/v1/products',
      {
        sku: product.sku,
        name: product.name,
        baseUnit: product.baseUnit,
        minStock: product.minStock,
        units: product.units,
        aliases: product.aliases,
      },
      idSchema,
    );
    products[product.key] = created.id;
  }

  for (const [index, warehouseId] of [main.id, branch.id].entries()) {
    const items = PRODUCTS.filter((product) => product.stockIn[index] !== '0').map((product) => ({
      productId: products[product.key],
      warehouseId,
      quantity: product.stockIn[index],
      unitCost: '10',
    }));
    await applyOperation(session, { type: 'STOCK_IN', note: 'Sohbet ölçümü girişi', items });
  }
  await applyOperation(session, {
    type: 'STOCK_OUT',
    note: 'Sohbet ölçümü çıkışı',
    items: [{ productId: products.nym, warehouseId: main.id, quantity: NYM_OUT }],
  });

  return { organizationId: organization.id, warehouses: { main: main.id, branch: branch.id }, products };
}

// ---------------------------------------------------------------------------------------------------------------
// Akışın ölçümü

interface StreamMeasurement {
  status: number;
  /** İstek gönderildikten sonra, milisaniye. */
  headersMs: number | null;
  messageStartedMs: number | null;
  firstToolMs: number | null;
  firstTextMs: number | null;
  lastTextMs: number | null;
  endMs: number | null;
  totalMs: number;
  textDeltas: number;
  pings: number;
  /** En uzun iki olay arası (ping dahil): bağlantının sessiz kaldığı en uzun süre. */
  longestGapMs: number;
  tools: string[];
  end: 'done' | 'error' | 'none';
  errorCode: string | null;
  replayed: boolean | null;
  text: string;
}

/**
 * Mesajı gönderir ve cevabı satır satır okur. SSE okuyucusunun aynısı (packages/api-client/src/chat-stream.ts), ama
 * `: ping` yorumlarını da sayar ve her olayın geliş zamanını tutar. API paketi istemci paketine bağımlı olmasın diye
 * burada ayrıca yazıldı.
 */
async function measureMessage(session: Session, conversationId: string, clientMessageId: string, text: string): Promise<StreamMeasurement> {
  const started = performance.now();
  const at = (): number => Math.round(performance.now() - started);
  const measurement: StreamMeasurement = {
    status: 0,
    headersMs: null,
    messageStartedMs: null,
    firstToolMs: null,
    firstTextMs: null,
    lastTextMs: null,
    endMs: null,
    totalMs: 0,
    textDeltas: 0,
    pings: 0,
    longestGapMs: 0,
    tools: [],
    end: 'none',
    errorCode: null,
    replayed: null,
    text: '',
  };

  const response = await fetch(`${apiUrl}/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: headers(session, { Accept: 'text/event-stream' }),
    body: JSON.stringify({ clientMessageId, text }),
  });
  measurement.status = response.status;
  measurement.headersMs = at();
  let lastActivity = measurement.headersMs;
  const activity = (): number => {
    const now = at();
    measurement.longestGapMs = Math.max(measurement.longestGapMs, now - lastActivity);
    lastActivity = now;
    return now;
  };

  if (!response.ok || !response.body) {
    measurement.text = await response.text();
    measurement.totalMs = at();
    return measurement;
  }

  const onEvent = (event: ChatStreamEvent, now: number): void => {
    switch (event.type) {
      case 'message_started':
        measurement.messageStartedMs = now;
        break;
      case 'tool_status':
        measurement.firstToolMs ??= now;
        if (event.status === 'started') {
          measurement.tools.push(event.tool);
        }
        break;
      case 'text_delta':
        measurement.firstTextMs ??= now;
        measurement.lastTextMs = now;
        measurement.textDeltas += 1;
        measurement.text += event.text;
        break;
      case 'done':
        measurement.endMs = now;
        measurement.end = 'done';
        measurement.text = event.text;
        measurement.replayed = event.replayed;
        break;
      case 'error':
        measurement.endMs = now;
        measurement.end = 'error';
        measurement.errorCode = event.code;
        measurement.text = event.message;
        break;
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line === '') {
        if (data.length > 0) {
          let json: unknown = null;
          try {
            json = JSON.parse(data.join('\n'));
          } catch {
            // Bozuk olay atlanır; istemci de atlar.
          }
          const parsed = chatStreamEventSchema.safeParse(json);
          if (parsed.success) {
            onEvent(parsed.data, activity());
          }
        }
        data = [];
      } else if (line.startsWith(':')) {
        measurement.pings += 1;
        activity();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (done) {
      break;
    }
  }
  measurement.totalMs = at();
  return measurement;
}

/** Türkçe harf ve büyük-küçük harf farkını yok sayarak karşılaştırma için. */
function fold(value: string): string {
  return value.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
}

function passes(question: Question, answer: string): boolean {
  const folded = fold(answer);
  return question.expect.every((group) => group.some((needle) => folded.includes(fold(needle))));
}

// ---------------------------------------------------------------------------------------------------------------
// ai_runs: soruların sunucu tarafı ölçümü. Toplamlar SQL'de alınır (maliyet NUMERIC; ADR-003).

const runSummarySchema = z.object({
  clientMessageId: z.uuid(),
  rounds: z.number().int(),
  serverMs: z.number().int(),
  serverFirstTextMs: z.number().int().nullable(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costUsd: z.string(),
  toolCalls: z.string().nullable(),
  stopReasons: z.string().nullable(),
  errorCodes: z.string().nullable(),
  model: z.string(),
  promptVersion: z.string(),
});
type RunSummary = z.infer<typeof runSummarySchema>;

async function readRuns(db: Database, organizationId: string): Promise<{ runs: RunSummary[]; totalCostUsd: string }> {
  const rows = await db.execute(sql`
    with runs as (
      select r.*, m.client_message_id,
             coalesce(sum(r.duration_ms) over (partition by r.message_id order by r.round_no
               rows between unbounded preceding and 1 preceding), 0) as before_ms
      from ai_runs r
      join messages m on m.organization_id = r.organization_id and m.id = r.message_id
      where r.organization_id = ${organizationId}
    )
    select client_message_id as "clientMessageId",
           count(*)::int as "rounds",
           sum(duration_ms)::int as "serverMs",
           min(before_ms + first_token_ms) filter (where first_token_ms is not null)::int as "serverFirstTextMs",
           sum(input_tokens)::int as "inputTokens",
           sum(output_tokens)::int as "outputTokens",
           sum(cache_read_input_tokens)::int as "cacheReadTokens",
           sum(cache_creation_input_tokens)::int as "cacheWriteTokens",
           sum(cost_usd)::text as "costUsd",
           string_agg(nullif(array_to_string(tool_calls, ','), ''), ',' order by round_no) as "toolCalls",
           string_agg(stop_reason, ',' order by round_no) as "stopReasons",
           string_agg(error_code, ',' order by round_no) as "errorCodes",
           min(model) as "model",
           min(prompt_version) as "promptVersion"
    from runs
    group by client_message_id`);
  const total = await db.execute(sql`select coalesce(sum(cost_usd), 0)::text as total from ai_runs where organization_id = ${organizationId}`);
  return {
    runs: z.array(runSummarySchema).parse(rows),
    totalCostUsd: z.array(z.object({ total: z.string() })).parse(total)[0]?.total ?? '0',
  };
}

// Silme sırası yabancı anahtarlara göre: önce bağlı kayıtlar, en son şirket.
const ORGANIZATION_TABLES = [
  'ai_runs',
  'messages',
  'conversations',
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
  'invitations',
  'organization_users',
  'warehouses',
] as const;

/** Geçici şirketi bütün kayıtlarıyla siler; kalan satır varsa tablo adıyla döner. */
async function removeFixture(db: Database, organizationId: string): Promise<string[]> {
  for (const table of ORGANIZATION_TABLES) {
    await db.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`);
  }
  await db.execute(sql`delete from organizations where id = ${organizationId}`);
  const leftovers: string[] = [];
  for (const table of ORGANIZATION_TABLES) {
    const rows = await db.execute(sql`select count(*)::int as count from ${sql.identifier(table)} where organization_id = ${organizationId}`);
    const count = z.array(z.object({ count: z.number().int() })).parse(rows)[0]?.count ?? 0;
    if (count > 0) {
      leftovers.push(`${table}: ${count}`);
    }
  }
  return leftovers;
}

// ---------------------------------------------------------------------------------------------------------------
// Rapor

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

interface QuestionResult {
  id: string;
  purpose: string;
  question: string;
  passed: boolean;
  stream: StreamMeasurement;
  server: RunSummary | null;
  /** İlk metin parçasından son olaya kadar istemcide ve sunucuda geçen süre: yakınsa akış biriktirilmeden geliyor. */
  clientTextSpanMs: number | null;
  serverTextSpanMs: number | null;
}

function textSpans(stream: StreamMeasurement, server: RunSummary | null): { client: number | null; server: number | null } {
  const client = stream.firstTextMs !== null && stream.endMs !== null ? stream.endMs - stream.firstTextMs : null;
  const serverSpan = server && server.serverFirstTextMs !== null ? server.serverMs - server.serverFirstTextMs : null;
  return { client, server: serverSpan };
}

function cell(value: number | null): string {
  return value === null ? '—' : String(value);
}

function printResults(results: QuestionResult[], totalCostUsd: string, stockUnchanged: boolean): void {
  console.log(`\nSohbet akışı ölçümü: ${label} (${apiUrl})`);
  console.log('Süreler milisaniye; "istemci" bu bilgisayarda ölçülen, "sunucu" ai_runs kaydı (model çağrılarının toplamı).\n');
  console.table(
    results.map((result) => ({
      soru: result.id,
      kontrol: result.passed ? 'geçti' : 'BAK',
      'ilk metin (istemci)': cell(result.stream.firstTextMs),
      'ilk metin (sunucu)': cell(result.server?.serverFirstTextMs ?? null),
      'toplam (istemci)': result.stream.totalMs,
      'toplam (sunucu)': cell(result.server?.serverMs ?? null),
      tur: cell(result.server?.rounds ?? null),
      parça: result.stream.textDeltas,
      ping: result.stream.pings,
      'en uzun sessizlik': result.stream.longestGapMs,
      'metin süresi istemci/sunucu': `${cell(result.clientTextSpanMs)}/${cell(result.serverTextSpanMs)}`,
      maliyet: result.server?.costUsd ?? '—',
      son: result.stream.end === 'error' ? `error ${result.stream.errorCode ?? ''}` : result.stream.end,
    })),
  );
  console.log(`Toplam maliyet: ${totalCostUsd} USD`);
  console.log(`Stok değiştirme isteğinden sonra stok değişmedi: ${stockUnchanged ? 'evet' : 'HAYIR'}`);
  console.log('Cevapların tamamı rapor dosyasında; "BAK" işaretli cevapları elle oku.');
}

function writeChatReport(report: unknown): string {
  const directory = path.join(repoRoot, 'eval', 'sohbet');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${label}-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const { token } = await signIn();
  const session: Session = { token, organizationId: null };
  const connection = createDatabase(required('DATABASE_URL'), { maxConnections: 1 });
  let fixture: Fixture | null = null;

  try {
    console.log(`${apiUrl} uyandırılıyor…`);
    await wakeUp(apiUrl);
    fixture = await createFixture(session);
    console.log('Geçici şirket kuruldu; sorular soruluyor.');

    const measured: { question: Question; clientMessageId: string; stream: StreamMeasurement }[] = [];
    for (const question of QUESTIONS) {
      const conversation = await post(session, '/v1/conversations', {}, idSchema);
      const clientMessageId = randomUUID();
      const stream = await measureMessage(session, conversation.id, clientMessageId, question.text);
      measured.push({ question, clientMessageId, stream });
      console.log(`${question.id}: ${stream.end}, ${stream.totalMs} ms`);
    }

    // Asistan stoğa yazamaz: "çıkış yap" isteğinden sonra Merkez'deki sigorta stoğu girişteki gibi kalmalı.
    // Miktarlar sayıya çevrilmeden aynı biçime getirilip metin olarak karşılaştırılır ("60.000" ve "60" → "60").
    const stock = await get(session, `/v1/products/${fixture.products.sigorta}/stock`, productStockSchema);
    const mainStock = stock.warehouses.find((row) => row.warehouse.id === fixture?.warehouses.main)?.quantity ?? null;
    const expectedStock = PRODUCTS.find((product) => product.key === 'sigorta')?.stockIn[0] ?? null;
    const stockUnchanged =
      mainStock !== null && expectedStock !== null && formatDecimal(mainStock) === formatDecimal(expectedStock);

    const { runs, totalCostUsd } = await readRuns(connection.db, fixture.organizationId);
    const results: QuestionResult[] = measured.map(({ question, clientMessageId, stream }) => {
      const server = runs.find((run) => run.clientMessageId === clientMessageId) ?? null;
      const spans = textSpans(stream, server);
      return {
        id: question.id,
        purpose: question.purpose,
        question: question.text,
        passed: stream.end === 'done' && passes(question, stream.text),
        stream,
        server,
        clientTextSpanMs: spans.client,
        serverTextSpanMs: spans.server,
      };
    });

    const done = results.filter((result) => result.stream.end === 'done');
    const report = {
      label,
      measuredAt: new Date().toISOString(),
      apiUrl,
      model: runs[0]?.model ?? null,
      promptVersion: runs[0]?.promptVersion ?? null,
      summary: {
        questions: results.length,
        completed: done.length,
        passedAutomaticCheck: results.filter((result) => result.passed).length,
        medianClientFirstTextMs: median(done.map((result) => result.stream.firstTextMs ?? Number.NaN)),
        medianServerFirstTextMs: median(done.map((result) => result.server?.serverFirstTextMs ?? Number.NaN)),
        medianClientTotalMs: median(done.map((result) => result.stream.totalMs)),
        medianServerTotalMs: median(done.map((result) => result.server?.serverMs ?? Number.NaN)),
        maxClientTotalMs: Math.max(0, ...results.map((result) => result.stream.totalMs)),
        totalPings: results.reduce((sum, result) => sum + result.stream.pings, 0),
        totalCostUsd,
        stockUnchangedAfterWriteRequest: stockUnchanged,
      },
      results,
    };
    printResults(results, totalCostUsd, stockUnchanged);
    console.log(`Kaydedildi: ${writeChatReport(report)}`);
  } finally {
    if (fixture) {
      const leftovers = await removeFixture(connection.db, fixture.organizationId);
      console.log(
        leftovers.length === 0
          ? 'Geçici şirket bütün kayıtlarıyla silindi.'
          : `UYARI: geçici şirketin (${fixture.organizationId}) kayıtları kaldı: ${leftovers.join(', ')}`,
      );
    } else if (session.organizationId) {
      // Şirket kuruldu ama kurulum yarıda kaldı: yine de silinir.
      const leftovers = await removeFixture(connection.db, session.organizationId);
      console.log(leftovers.length === 0 ? 'Yarıda kalan geçici şirket silindi.' : `UYARI: kalan kayıtlar: ${leftovers.join(', ')}`);
    }
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error('Ölçüm başarısız:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
