// 5. haftanın kapısı (#79): sohbette önerilen işlem kartla onaylanınca stok tam bir kez değişir. Aynı kart iki kez
// onaylansa, ağ hatasında tekrar gönderilse ya da iki cihazdan aynı anda onaylansa da sonuç değişmez; onay ile iptal ya
// da düzenleme yarışınca tutarlı tek bir sonuç kalır; süresi dolmuş öneri hiç uygulanmaz.
//
// Öneriler gerçek sohbet akışından açılır (Claude yerine sahte sağlayıcı; araçlar, kayıtlar ve stok gerçek). Onay ve
// iptal, kartın yaptığı gibi HTTP'den gider. Yarışlar rastlantıya bırakılmaz: test işlem satırını kendi
// transaction'ında kilitler, isteklerin kilidi beklediğini pg_stat_activity'de görünce bırakır (raceWhileLocked, 3. hafta).
import { randomUUID } from 'node:crypto';

import type { MessageContentBlock } from '@ambarci/db';
import {
  apiErrorSchema,
  chatMessageListSchema,
  chatStreamEventSchema,
  confirmOperationResultSchema,
  conversationSchema,
} from '@ambarci/shared';
import type { ChatStreamEvent, Operation } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AIProvider } from '../src/modules/ai/ai-provider.js';
import type { AiToolCall } from '../src/modules/ai/ai-provider.js';
import { ToolRegistry } from '../src/modules/assistant/tools/registry.js';
import type { ToolContext, ToolOutcome } from '../src/modules/assistant/tools/registry.js';
import { aiResult, ScriptedAiProvider } from '../test/support/scripted-ai-provider.js';
import { createStockFixture, raceWhileLocked } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

function parseEvents(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '' && !block.startsWith(':'))
    .map((block) => chatStreamEventSchema.parse(JSON.parse(block.split('\n').find((line) => line.startsWith('data: '))?.slice(6) ?? '')));
}

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

function toolTurn(calls: AiToolCall[]): ReturnType<typeof aiResult> {
  const content: MessageContentBlock[] = [
    { type: 'thinking', thinking: '', signature: 'imza' },
    ...calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
  ];
  return aiResult({ content, toolCalls: calls, stopReason: 'tool_use', text: '' });
}

/** Kartın onay isteği yalnızca işlemin kimliğini ve gösterdiği sürümü kullanır. */
function card(id: string, version: number): Operation {
  return { id, version } as Operation;
}

describe('5. hafta kapısı: onay stoğu tam bir kez değiştirir (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let tools: ToolRegistry;
  let admin: ToolContext;
  const provider = new ScriptedAiProvider();
  const cable = randomUUID();

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Kapı 5', overrides: [{ provide: AIProvider, useValue: provider }] });
    tools = fx.app.get(ToolRegistry, { strict: false });
    await fx.db.execute(sql`insert into products (id, organization_id, sku, name, base_unit)
      values (${cable}, ${fx.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre')`);
    await fx.db.execute(sql`insert into product_units (organization_id, product_id, unit, factor)
      values (${fx.org}, ${cable}, 'makara', '100')`);
    // Merkez'de 2.000 metre.
    await fx.apply('STOCK_IN', [{ productId: cable, warehouseId: fx.main, quantity: '20', unit: 'makara', unitCost: '1500' }]);
    const [membership] = await fx.db.execute<{ id: string }>(sql`
      select id from organization_users where organization_id = ${fx.org} and user_id = ${fx.admin}`);
    admin = { organization: { id: fx.org, role: 'ADMIN', membershipId: membership?.id ?? '' }, userId: fx.admin };
  });

  afterAll(async () => {
    await fx?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  /** Yeni sohbette "Merkezden N makara kablo çıkışı yap": model öneri aracını çağırır, kart olayı gelir. */
  async function proposeInChat(makara: string): Promise<{ operationId: string; messageId: string }> {
    const conversationId = conversationSchema.parse((await fx.call('post', '/v1/conversations').expect(201)).body).id;
    provider.push(
      toolTurn([
        {
          id: `toolu_${randomUUID()}`,
          name: 'propose_stock_out',
          input: { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: makara, unit: 'makara' }] },
        },
      ]),
      aiResult({ text: "Çıkış önerisi hazır; kartı kontrol edip Onayla'ya bas." }),
    );
    const response = await streamed(
      fx.call('post', `/v1/conversations/${conversationId}/messages`).send({ clientMessageId: randomUUID(), text: `Merkezden ${makara} makara kablo çıkışı yap` }),
    ).expect(200);
    const events = parseEvents(response.body as string);
    const started = events.find((event) => event.type === 'message_started');
    const cardEvent = events.find((event) => event.type === 'operation_card');
    if (started?.type !== 'message_started' || cardEvent?.type !== 'operation_card') {
      throw new Error('Öneri turu kart olayı vermedi.');
    }
    return { operationId: cardEvent.operationId, messageId: started.messageId };
  }

  async function statusOf(id: string): Promise<string | undefined> {
    return fx.statusOf(id);
  }

  /** Değişmez: her depoda stok, o deponun hareketlerinin toplamıdır (stok yalnızca hareketle değişir). */
  async function expectStockEqualsMovements(): Promise<void> {
    const rows = await fx.db.execute<{ quantity: string; moved: string }>(sql`
      select i.quantity::text as quantity, coalesce((
        select sum(m.quantity_change) from inventory_movements m
        where m.organization_id = i.organization_id and m.warehouse_id = i.warehouse_id and m.product_id = i.product_id
      ), 0)::numeric(14,3)::text as moved
      from inventory i where i.organization_id = ${fx.org}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.quantity).toBe(row.moved);
    }
  }

  async function stock(): Promise<string | undefined> {
    return (await fx.stockOf(fx.main, cable))?.quantity;
  }

  it('sohbetten öneri, kartla onay: stok bir kez değişir; ağ hatasında aynı anahtarla tekrar aynı cevabı alır', async () => {
    const { operationId } = await proposeInChat('1');
    expect(await stock()).toBe('2000.000');
    const key = randomUUID();

    const first = await fx.confirm(card(operationId, 1), key).expect(200);
    // İstemci cevabı alamadı (bağlantı koptu) ve aynı anahtarla yeniden gönderdi.
    const retry = await fx.confirm(card(operationId, 1), key).expect(200);

    expect(confirmOperationResultSchema.parse(retry.body)).toEqual(confirmOperationResultSchema.parse(first.body));
    expect(await stock()).toBe('1900.000');
    expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
    await expectStockEqualsMovements();
  });

  it('aynı kart aynı anda iki kez (çift dokunma, aynı anahtar): ikisi de aynı cevap, stok bir kez', async () => {
    const { operationId } = await proposeInChat('1');
    const before = await stock();
    const key = randomUUID();

    const responses = await raceWhileLocked(fx.db, [sql`select 1 from operations where id = ${operationId} for update`], 2, () => [
      fx.confirm(card(operationId, 1), key),
      fx.confirm(card(operationId, 1), key),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses[0]?.body).toEqual(responses[1]?.body);
    expect(before).toBe('1900.000');
    expect(await stock()).toBe('1800.000');
    expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
    await expectStockEqualsMovements();
  });

  it('iki cihazdan aynı anda (farklı anahtar): biri uygulanır, öteki 409 OPERATION_ALREADY_APPLIED; stok bir kez', async () => {
    const { operationId } = await proposeInChat('1');

    const responses = await raceWhileLocked(fx.db, [sql`select 1 from operations where id = ${operationId} for update`], 2, () => [
      fx.confirm(card(operationId, 1), randomUUID()),
      fx.confirm(card(operationId, 1), randomUUID()),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(errorCode(responses.find((response) => response.status === 409)?.body)).toBe('OPERATION_ALREADY_APPLIED');
    expect(await stock()).toBe('1700.000');
    expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
    await expectStockEqualsMovements();
  });

  it('onay ile iptal aynı anda: yalnızca biri olur; öteki 409 OPERATION_NOT_PENDING; stok en fazla bir kez', async () => {
    const { operationId } = await proposeInChat('1');
    const before = await stock();

    const [confirmed, cancelled] = await raceWhileLocked(fx.db, [sql`select 1 from operations where id = ${operationId} for update`], 2, () => [
      fx.confirm(card(operationId, 1), randomUUID()),
      fx.call('post', `/v1/operations/${operationId}/cancel`),
    ]);

    const statuses = [confirmed?.status, cancelled?.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = confirmed?.status === 409 ? confirmed : cancelled;
    expect(errorCode(loser?.body)).toBe('OPERATION_NOT_PENDING');
    if (confirmed?.status === 200) {
      expect(await statusOf(operationId)).toBe('APPLIED');
      expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
      expect(await stock()).not.toBe(before);
    } else {
      expect(await statusOf(operationId)).toBe('CANCELLED');
      expect(await fx.writtenFor(operationId)).toEqual({ movements: 0, audits: 0, events: 0 });
      expect(await stock()).toBe(before);
    }
    await expectStockEqualsMovements();
  });

  it('sohbette düzenleme ile eski kartın onayı aynı anda: tek sonuç; eski sürüm uygulanırsa düzenleme reddedilir', async () => {
    const { operationId, messageId } = await proposeInChat('1');
    const before = await stock();

    // İki farklı istek aynı kilide yarışır: kartın eski sürümle onayı (HTTP) ve asistanın düzenlemesi (araç).
    let confirmed: request.Response | undefined;
    let revised: ToolOutcome | undefined;
    await raceWhileLocked<void>(fx.db, [sql`select 1 from operations where id = ${operationId} for update`], 2, () => [
      Promise.resolve(fx.confirm(card(operationId, 1), randomUUID())).then((response) => {
        confirmed = response;
      }),
      tools
        .execute(
          'propose_stock_out',
          { operation_id: operationId, warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '3', unit: 'makara' }] },
          { ...admin, messageId },
        )
        .then((outcome) => {
          revised = outcome;
        }),
    ]);

    if (confirmed?.status === 200) {
      // Eski kart önce kilidi aldı: 1 makara uygulandı, düzenleme "onay beklemiyor" aldı.
      expect(revised).toEqual({ isError: true, content: 'Bu işlem onay beklemiyor; düzenlenemez.' });
      expect(await statusOf(operationId)).toBe('APPLIED');
      expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
    } else {
      // Düzenleme önce: sürüm 2 oldu, eski kartın onayı sürüm farkıyla reddedildi, stok değişmedi.
      expect(revised?.isError).toBe(false);
      expect(errorCode(confirmed?.body)).toBe('OPERATION_VERSION_MISMATCH');
      expect(await statusOf(operationId)).toBe('PENDING_CONFIRMATION');
      expect(await stock()).toBe(before);
    }
    await expectStockEqualsMovements();
  });

  it('süresi dolmuş öneriye aynı anda iki onay: hiçbiri uygulanmaz; süre aşımı bir kez yazılır', async () => {
    const { operationId } = await proposeInChat('1');
    await fx.db.execute(sql`update operations set updated_at = now() - interval '31 minutes' where id = ${operationId}`);
    const before = await stock();

    const responses = await raceWhileLocked(fx.db, [sql`select 1 from operations where id = ${operationId} for update`], 2, () => [
      fx.confirm(card(operationId, 1), randomUUID()),
      fx.confirm(card(operationId, 1), randomUUID()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    expect(responses.map((response) => errorCode(response.body)).sort()).toEqual(['OPERATION_EXPIRED', 'OPERATION_NOT_PENDING']);
    expect(await statusOf(operationId)).toBe('EXPIRED');
    expect(await stock()).toBe(before);
    const [audits] = await fx.db.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_logs where entity_id = ${operationId} and action = 'operation.expired'`);
    expect(audits?.count).toBe(1);
    await expectStockEqualsMovements();
  });

  // Telefondaki kapı denemesinin 6. adımı (19 Kasım): tek "fire yaz" mesajında model aynı fire önerisini dört kez
  // çağırdı, dört kart açıldı ve dördü de onaylanabildi. Her kart bir kez uygulandı ama kullanıcının tek isteği stoğu
  // dört kez düşürdü.
  it('model aynı öneriyi bir turda tekrar tekrar çağırırsa: tek öneri, aynı kart; onayla stok bir kez değişir', async () => {
    const conversationId = conversationSchema.parse((await fx.call('post', '/v1/conversations').expect(201)).body).id;
    const waste = (): AiToolCall => ({
      id: `toolu_${randomUUID()}`,
      name: 'propose_waste',
      input: { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '1', unit: 'makara' }] },
    });
    // Üç tur aynı çağrı; üçüncüsünde aynı çağrı iki kez, paralel.
    provider.push(
      toolTurn([waste()]),
      toolTurn([waste()]),
      toolTurn([waste(), waste()]),
      aiResult({ text: "Fire önerisi hazır; kartı kontrol edip Onayla'ya bas." }),
    );

    const response = await streamed(
      fx.call('post', `/v1/conversations/${conversationId}/messages`).send({ clientMessageId: randomUUID(), text: 'Merkezde 1 makara kablo kırık geldi, fire yaz' }),
    ).expect(200);

    const events = parseEvents(response.body as string);
    const started = events.find((event) => event.type === 'message_started');
    const cardIds = events.flatMap((event) => (event.type === 'operation_card' ? [event.operationId] : []));
    expect(cardIds).toHaveLength(4);
    expect(new Set(cardIds).size).toBe(1);
    const operationId = cardIds[0] ?? '';
    const [opened] = await fx.db.execute<{ count: number }>(sql`
      select count(*)::int as count from operations
      where organization_id = ${fx.org} and source_message_id = ${started?.type === 'message_started' ? started.messageId : null}`);
    expect(opened?.count).toBe(1);

    const before = await stock();
    await fx.confirm(card(operationId, 1), randomUUID()).expect(200);
    expect(await stock()).toBe((Number(before) - 100).toFixed(3));
    expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
    await expectStockEqualsMovements();
  });

  // Telefon denemesinin 9. adımı (20 Kasım): iki kart onaylandıktan sonra kullanıcı yeni bir çıkış istedi. Model önceki
  // araç sonuçlarında kartları hâlâ "Onay bekliyor" gördü ve "kart zaten hazır" deyip yeni öneri açmadı.
  it('kart sohbet dışında onaylanınca sonraki mesajda model bunu sunucu notundan öğrenir; not ekranda görünmez', async () => {
    const conversationId = conversationSchema.parse((await fx.call('post', '/v1/conversations').expect(201)).body).id;
    const ask = 'Merkezden 1 makara kablo çıkışı yap';
    const send = (): request.Test =>
      streamed(fx.call('post', `/v1/conversations/${conversationId}/messages`).send({ clientMessageId: randomUUID(), text: ask }));

    provider.push(
      toolTurn([
        {
          id: `toolu_${randomUUID()}`,
          name: 'propose_stock_out',
          input: { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '1', unit: 'makara' }] },
        },
      ]),
      aiResult({ text: "Çıkış önerisi hazır; kartı kontrol edip Onayla'ya bas." }),
    );
    const firstTurn = parseEvents((await send().expect(200)).body as string);
    const operationId = firstTurn.flatMap((event) => (event.type === 'operation_card' ? [event.operationId] : []))[0] ?? '';
    // Kullanıcı kartı onayladı: sohbette hiçbir mesaj yazılmadı, model bunu geçmişten göremez.
    await fx.confirm(card(operationId, 1), randomUUID()).expect(200);

    const sent = provider.requests.length;
    provider.push(aiResult({ text: 'Yeni çıkış önerisi hazırlıyorum.' }));
    await send().expect(200);

    // Modele giden son kullanıcı mesajı: önce kullanıcının yazdığı, sonra sunucunun notu (öneri artık Uygulandı).
    const last = provider.requests[sent]?.messages.at(-1);
    expect(last?.role).toBe('user');
    const texts = (last?.content as { type: string; text?: string }[])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '');
    expect(texts[0]).toBe(ask);
    expect(texts[1]).toContain('[Sunucu notu, kullanıcı yazmadı]');
    expect(texts[1]).toContain(`- ${operationId}: Çıkış, Uygulandı`);

    // Ekranda kullanıcı mesajları yalnızca yazıldığı gibi.
    const { items } = chatMessageListSchema.parse((await fx.call('get', `/v1/conversations/${conversationId}/messages`).expect(200)).body);
    expect(items.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([ask, ask]);
  });

  it('aynı mesajdan aynı öneri aynı anda iki kez: biri açar, öteki onu alır; farklı kalemli öneri ayrı açılır', async () => {
    // Mesajın ilk önerisi: 1 makara. Ardından aynı mesajda 2 makaralık öneri iki kez, kilit altında aynı anda.
    const { operationId: first, messageId } = await proposeInChat('1');
    const input = { warehouse_id: fx.main, lines: [{ product_id: cable, quantity: '2', unit: 'makara' }] };

    const outcomes = await raceWhileLocked(
      fx.db,
      [sql`select pg_advisory_xact_lock(hashtextextended(${messageId}::text, 0))`],
      2,
      () => [
        tools.execute('propose_stock_out', input, { ...admin, messageId }),
        tools.execute('propose_stock_out', input, { ...admin, messageId }),
      ],
    );

    expect(outcomes.map((outcome) => outcome.isError)).toEqual([false, false]);
    const results = outcomes.map((outcome) => JSON.parse(outcome.content) as { operation_id: string; next_step: string });
    expect(results[0]?.operation_id).toBe(results[1]?.operation_id);
    expect(results[0]?.operation_id).not.toBe(first);
    // Kilidi ilk alan öneriyi açtı; ikincisi onu buldu ve modele "yeni öneri açılmadı" dendi.
    expect(results.filter((result) => result.next_step.includes('yeni öneri açılmadı'))).toHaveLength(1);
    const rows = await fx.db.execute<{ id: string }>(sql`
      select id from operations where organization_id = ${fx.org} and source_message_id = ${messageId} order by created_at`);
    expect(rows.map((row) => row.id)).toEqual([first, results[0]?.operation_id]);
    const [created] = await fx.db.execute<{ count: number }>(sql`
      select count(*)::int as count from audit_logs where entity_id = ${results[0]?.operation_id ?? null} and action = 'operation.created'`);
    expect(created?.count).toBe(1);
  });
});
