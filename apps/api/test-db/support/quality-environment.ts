// Değerlendirme koşusunun ortamı (#85). Gerçek veritabanında iki geçici şirket kurar:
//  - ABC Elektrik'in kopyası: demo kataloğu (depolar, ürünler, birimler, alternatif adlar, cariler) ve açılış stokları,
//    artı adına talimat gömülmüş bir test ürünü ve bir test carisi (araç sonucundaki talimat kategorisi);
//  - Kuzey Tesisat'ın kopyası: yalnızca ürünleri. Asistan bu şirketin ürünlerini görmemeli ("bulunamadı" mesajları).
// İki kullanıcı açılır: yönetici (bütün depolar) ve çalışan (yalnızca Merkez Depo ve Ostim Depo).
//
// API, testlerdeki gibi bu süreçte açılır; Claude sahte değildir. Model, effort ve günlük token bütçesi AI_CONFIG
// sağlayıcısı değiştirilerek verilir: bütçe koşunun ortasında dolmasın diye yüksek tutulur. close() her şeyi siler.
import { randomUUID } from 'node:crypto';

import {
  createDatabase,
  organizations,
  organizationUsers,
  parties,
  productAliases,
  products,
  productUnits,
  userWarehouseAccess,
  warehouses,
} from '@ambarci/db';
import type { Database } from '@ambarci/db';
import { abcElektrik, abcElektrikOpeningStock, kuzeyTesisat } from '@ambarci/db/demo';
import type { DemoCompany, DemoOpeningStock } from '@ambarci/db/demo';
import { chatStreamEventSchema, conversationSchema, ORGANIZATION_HEADER } from '@ambarci/shared';
import type { ChatStreamEvent } from '@ambarci/shared';
import type { INestApplication } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';

import { AI_CONFIG, readAiConfig } from '../../src/modules/ai/ai.config.js';
import type { AiConfig } from '../../src/modules/ai/ai.config.js';
import type { AiEffort } from '../../src/modules/ai/ai-provider.js';
import { OperationsService } from '../../src/modules/operations/operations.service.js';
import { EMPLOYEE_WAREHOUSES, INJECTED_PARTY, INJECTED_PRODUCT } from '../../src/scripts/assistant-quality/fixture.js';
import type { CaseMetrics, ToolCall } from '../../src/scripts/assistant-quality/report.js';
import type { ObservedOperation, ObservedTurn } from '../../src/scripts/assistant-quality/scoring.js';
import { seedOpeningStock } from '../../src/scripts/opening-stock.js';
import { createTestApp } from '../../test/create-test-app.js';
import { createTestTokens } from '../../test/support/test-tokens.js';
import { databaseUrl } from './stock-fixture.js';

/** Geçici şirketin silinme sırası: yabancı anahtarlara göre önce bağlı kayıtlar (measure-chat-remote.ts ile aynı). */
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

/** Geçici model hataları: aynı mesaj kimliğiyle yeniden gönderilir (API bunu destekler, model yeniden çağrılır). */
const RETRYABLE = new Set(['AI_RATE_LIMITED', 'AI_OVERLOADED', 'AI_UNAVAILABLE']);
/** Bütün koşuyu boşa çıkaran hatalar: ilk mesajda durulur. */
const FATAL = new Set(['AI_NOT_CONFIGURED', 'AI_AUTH_FAILED']);
const RETRY_DELAYS_MS = [10_000, 30_000];

export type Account = 'admin' | 'employee';

export interface QualityEnvironment {
  /** API'nin gerçekten kullandığı model ve effort. */
  model: string;
  effort: AiEffort;
  createConversation: (account: Account) => Promise<string>;
  send: (account: Account, conversationId: string, text: string) => Promise<ObservedTurn>;
  operationsOf: (conversationId: string) => Promise<ObservedOperation[]>;
  /** Modelin çağırdığı araçlar ve girdileri, sohbetteki sırayla (asistan mesajlarının tool_use blokları). */
  toolCallsOf: (conversationId: string) => Promise<ToolCall[]>;
  metricsOf: (conversationId: string) => Promise<Omit<CaseMetrics, 'clientMs'>>;
  /** Stok satırları ve hareket sayısının özeti: asistan stoğa yazamaz, koşu boyunca değişmemeli. */
  stockSnapshot: () => Promise<string>;
  /** Koşunun toplam ve mesaj başına maliyeti (SQL'de, metin olarak). */
  costSummary: (caseCount: number) => Promise<{ totalCostUsd: string; costPerCaseUsd: string }>;
  close: () => Promise<void>;
}

export interface QualityEnvironmentOptions {
  model: string | null;
  effort: AiEffort | null;
}

function parseEvents(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '' && !block.startsWith(':'))
    .flatMap((block) => {
      const data = block.split('\n').find((line) => line.startsWith('data: '));
      const parsed = chatStreamEventSchema.safeParse(data ? JSON.parse(data.slice(6)) : null);
      return parsed.success ? [parsed.data] : [];
    });
}

/** SSE cevabını metin olarak toplar (supertest varsayılanda akışı ayrıştırmaz). */
function streamed(test: request.Test): request.Test {
  return test.buffer(true).parse((response, callback) => {
    let text = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      text += chunk;
    });
    response.on('end', () => callback(null, text));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function insertCatalog(db: Database, organizationId: string, company: DemoCompany): Promise<void> {
  await db.insert(warehouses).values(company.warehouses.map((warehouse) => ({ organizationId, name: warehouse.name, type: warehouse.type })));
  const rows = await db
    .insert(products)
    .values(
      company.products.map((product) => ({
        organizationId,
        sku: product.sku,
        name: product.name,
        baseUnit: product.baseUnit,
        barcode: product.barcode,
        minStock: product.minStock,
      })),
    )
    .returning({ id: products.id, sku: products.sku });
  const idOf = new Map(rows.map((row) => [row.sku, row.id]));
  const productId = (sku: string): string => {
    const id = idOf.get(sku);
    if (!id) {
      throw new Error(`Ürün eklenemedi: ${sku}`);
    }
    return id;
  };
  await db
    .insert(productUnits)
    .values(company.products.map((product) => ({ organizationId, productId: productId(product.sku), unit: product.unit.name, factor: product.unit.factor })));
  await db
    .insert(productAliases)
    .values(company.products.flatMap((product) => product.aliases.map((alias) => ({ organizationId, productId: productId(product.sku), alias }))));
  if (company.parties.length > 0) {
    await db.insert(parties).values(company.parties.map((party) => ({ organizationId, name: party.name, type: party.type, taxId: party.taxId })));
  }
}

const operationRowSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  status: z.string(),
  version: z.number().int(),
  party: z.string().nullable(),
  note: z.string().nullable(),
  lines: z.array(
    z.object({
      sku: z.string(),
      warehouse: z.string(),
      targetWarehouse: z.string().nullable(),
      quantity: z.string(),
      unit: z.string().nullable(),
      baseQuantity: z.string(),
      unitCost: z.string().nullable(),
    }),
  ),
});

const metricsRowSchema = z.object({
  rounds: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  costUsd: z.string(),
  serverMs: z.number().int(),
  tools: z.string(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});

export async function createQualityEnvironment(options: QualityEnvironmentOptions): Promise<QualityEnvironment> {
  const base = readAiConfig();
  if (!base.apiKey) {
    throw new Error('ANTHROPIC_API_KEY tanımlı değil. Depo kökündeki .env dosyasını kontrol edin.');
  }
  const config: AiConfig = {
    ...base,
    chatModel: options.model ?? base.chatModel,
    chatEffort: options.effort ?? base.chatEffort,
    // Koşu 100 mesaja kadar sürer; günlük bütçe yarıda kesmesin (bu şirket ve kullanıcılar yalnızca koşu için var).
    dailyTokenLimitPerUser: 100_000_000,
    dailyTokenLimitPerOrganization: 100_000_000,
  };

  const connection = createDatabase(databaseUrl(), { maxConnections: 3 });
  const { db } = connection;
  const org = randomUUID();
  const otherOrg = randomUUID();
  const users: Record<Account, string> = { admin: randomUUID(), employee: randomUUID() };
  const tokens = await createTestTokens();
  let app: INestApplication<App> | null = null;

  const close = async (): Promise<void> => {
    await app?.close();
    for (const organizationId of [org, otherOrg]) {
      for (const table of ORGANIZATION_TABLES) {
        await db.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`);
      }
      await db.execute(sql`delete from organizations where id = ${organizationId}`);
    }
    await db.execute(sql`delete from auth.users where id in (${users.admin}, ${users.employee})`);
    await connection.close();
  };

  try {
    const suffix = org.slice(0, 8);
    for (const [account, id] of Object.entries(users)) {
      await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`degerlendirme-${account}-${id}@test.invalid`})`);
    }
    await db.insert(organizations).values([
      { id: org, name: `Değerlendirme ${abcElektrik.name} ${suffix}` },
      { id: otherOrg, name: `Değerlendirme ${kuzeyTesisat.name} ${suffix}` },
    ]);
    await insertCatalog(db, org, {
      ...abcElektrik,
      parties: [...abcElektrik.parties, INJECTED_PARTY],
      products: [
        ...abcElektrik.products,
        {
          sku: INJECTED_PRODUCT.sku,
          name: INJECTED_PRODUCT.name,
          baseUnit: INJECTED_PRODUCT.baseUnit,
          barcode: INJECTED_PRODUCT.barcode,
          minStock: INJECTED_PRODUCT.minStock,
          unit: INJECTED_PRODUCT.unit,
          aliases: [],
        },
      ],
    });
    await insertCatalog(db, otherOrg, { ...kuzeyTesisat, parties: [] });

    await db.insert(organizationUsers).values({ organizationId: org, userId: users.admin, role: 'ADMIN' });
    const [employee] = await db
      .insert(organizationUsers)
      .values({ organizationId: org, userId: users.employee, role: 'EMPLOYEE' })
      .returning({ id: organizationUsers.id });
    if (!employee) {
      throw new Error('Çalışan üyeliği eklenemedi.');
    }
    const warehouseRows = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.organizationId, org));
    await db.insert(userWarehouseAccess).values(
      warehouseRows
        .filter((row) => EMPLOYEE_WAREHOUSES.includes(row.name))
        .map((row) => ({ organizationId: org, organizationUserId: employee.id, warehouseId: row.id })),
    );

    app = await createTestApp({ accessTokenVerifier: tokens.verifier, overrides: [{ provide: AI_CONFIG, useValue: config }] });

    // Açılış stokları demo verisindeki gibi: açılış işlemi açılır ve onay transaction'ından geçer.
    const opening: DemoOpeningStock[] = abcElektrikOpeningStock.map((stock) =>
      stock.warehouse === 'Merkez Depo'
        ? { ...stock, lines: [...stock.lines, { sku: INJECTED_PRODUCT.sku, quantity: INJECTED_PRODUCT.quantity, unitCost: INJECTED_PRODUCT.unitCost }] }
        : stock,
    );
    await seedOpeningStock(db, app.get(OperationsService, { strict: false }), org, opening);
  } catch (error) {
    await close();
    throw error;
  }

  const server = app.getHttpServer();
  // Senkron olmalı: supertest isteği "thenable"dır; async bir fonksiyondan dönerse orada gönderilir. Token her istekte
  // yeniden üretilir (çağıran await eder), çünkü koşu bir saati aşabilir ve test token'ı bir saat geçerlidir.
  const post = (token: string, path: string): request.Test =>
    request(server).post(path).set('Authorization', `Bearer ${token}`).set(ORGANIZATION_HEADER, org);
  const tokenOf = (account: Account): Promise<string> => tokens.tokenFor(users[account]);

  return {
    model: config.chatModel,
    effort: config.chatEffort,

    async createConversation(account) {
      const response = await post(await tokenOf(account), '/v1/conversations').send({});
      if (response.status !== 201) {
        throw new Error(`Sohbet açılamadı (${response.status}): ${JSON.stringify(response.body)}`);
      }
      return conversationSchema.parse(response.body).id;
    },

    async send(account, conversationId, text) {
      const clientMessageId = randomUUID();
      const started = performance.now();
      for (let retries = 0; ; retries += 1) {
        const token = await tokenOf(account);
        const response = await streamed(post(token, `/v1/conversations/${conversationId}/messages`)).send({ clientMessageId, text });
        const body = typeof response.body === 'string' ? response.body : '';
        const turn: ObservedTurn = { text: '', error: null, cards: 0, tools: [], durationMs: 0, retries };
        if (response.status !== 200) {
          turn.error = { code: `HTTP_${response.status}`, message: body.slice(0, 500) };
        }
        for (const event of response.status === 200 ? parseEvents(body) : []) {
          if (event.type === 'tool_status' && event.status === 'started') {
            turn.tools.push(event.tool);
          } else if (event.type === 'operation_card') {
            turn.cards += 1;
          } else if (event.type === 'done') {
            turn.text = event.text;
          } else if (event.type === 'error') {
            turn.error = { code: event.code, message: event.message };
          }
        }
        if (response.status === 200 && !turn.error && turn.text === '') {
          turn.error = { code: 'NO_DONE_EVENT', message: 'Akış done ya da error olayı olmadan bitti.' };
        }
        if (turn.error && FATAL.has(turn.error.code)) {
          throw new Error(`Model çağrılamıyor (${turn.error.code}): ${turn.error.message}`);
        }
        const delay = turn.error && RETRYABLE.has(turn.error.code) ? RETRY_DELAYS_MS[retries] : undefined;
        if (delay === undefined) {
          turn.durationMs = Math.round(performance.now() - started);
          return turn;
        }
        await sleep(delay);
      }
    },

    async operationsOf(conversationId) {
      const rows = await db.execute(sql`
        select o.id, o.type::text as type, o.status::text as status, o.version, p.name as party, o.note,
               coalesce(json_agg(json_build_object(
                 'sku', pr.sku,
                 'warehouse', w.name,
                 'targetWarehouse', tw.name,
                 'quantity', oi.quantity::text,
                 'unit', oi.unit,
                 'baseQuantity', (oi.quantity * coalesce(pu.factor, 1))::numeric(14,3)::text,
                 'unitCost', oi.unit_cost::text
               ) order by oi.line_no) filter (where oi.id is not null), '[]'::json) as lines
        from operations o
        left join parties p on p.organization_id = o.organization_id and p.id = o.party_id
        left join operation_items oi on oi.organization_id = o.organization_id and oi.operation_id = o.id
        left join products pr on pr.organization_id = oi.organization_id and pr.id = oi.product_id
        left join product_units pu on pu.organization_id = oi.organization_id and pu.product_id = oi.product_id and pu.unit = oi.unit
        left join warehouses w on w.organization_id = oi.organization_id and w.id = oi.warehouse_id
        left join warehouses tw on tw.organization_id = oi.organization_id and tw.id = oi.target_warehouse_id
        where o.organization_id = ${org}
          and o.source_message_id in (select m.id from messages m where m.organization_id = ${org} and m.conversation_id = ${conversationId})
        group by o.id, p.name
        order by o.created_at`);
      return z.array(operationRowSchema).parse(rows);
    },

    async toolCallsOf(conversationId) {
      const rows = await db.execute(sql`
        select block->>'name' as name, block->'input' as input
        from messages m
        cross join lateral jsonb_array_elements(m.content) with ordinality as b(block, idx)
        where m.organization_id = ${org} and m.conversation_id = ${conversationId}
          and m.role = 'ASSISTANT' and b.block->>'type' = 'tool_use'
        order by m.position, b.idx`);
      return z.array(z.object({ name: z.string(), input: z.unknown() })).parse(rows);
    },

    async metricsOf(conversationId) {
      const rows = await db.execute(sql`
        select count(*)::int as "rounds",
               coalesce(sum(r.input_tokens), 0)::int as "inputTokens",
               coalesce(sum(r.output_tokens), 0)::int as "outputTokens",
               coalesce(sum(r.cache_read_input_tokens), 0)::int as "cacheReadTokens",
               coalesce(sum(r.cache_creation_input_tokens), 0)::int as "cacheWriteTokens",
               coalesce(sum(r.cost_usd), 0)::text as "costUsd",
               coalesce(sum(r.duration_ms), 0)::int as "serverMs",
               coalesce(string_agg(nullif(array_to_string(r.tool_calls, ','), ''), ',' order by m.created_at, r.round_no), '') as "tools",
               min(r.model) as "model",
               min(r.prompt_version) as "promptVersion"
        from ai_runs r
        join messages m on m.organization_id = r.organization_id and m.id = r.message_id
        where r.organization_id = ${org} and m.conversation_id = ${conversationId}`);
      const [row] = z.array(metricsRowSchema).parse(rows);
      if (!row) {
        throw new Error('ai_runs özeti okunamadı.');
      }
      const { tools, ...rest } = row;
      return { ...rest, tools: tools === '' ? [] : tools.split(',') };
    },

    async stockSnapshot() {
      const [row] = await db.execute<{ snapshot: string }>(sql`
        select coalesce((
          select string_agg(i.warehouse_id::text || ':' || i.product_id::text || ':' || i.quantity::text, ',' order by i.warehouse_id, i.product_id)
          from inventory i where i.organization_id = ${org}
        ), '') || '|' || (select count(*) from inventory_movements m where m.organization_id = ${org})::text as snapshot`);
      return row?.snapshot ?? '';
    },

    async costSummary(caseCount) {
      const [row] = await db.execute<{ total: string; perCase: string }>(sql`
        select coalesce(sum(cost_usd), 0)::text as total,
               round(coalesce(sum(cost_usd), 0) / greatest(${caseCount}::int, 1), 6)::text as "perCase"
        from ai_runs where organization_id = ${org}`);
      return { totalCostUsd: row?.total ?? '0', costPerCaseUsd: row?.perCase ?? '0' };
    },

    close,
  };
}
