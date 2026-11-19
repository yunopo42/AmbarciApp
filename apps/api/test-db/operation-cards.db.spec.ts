// Sohbette işlem kartı için API gerçek veritabanında (#75): öneri aracı başarılı olunca akışa operation_card olayı
// gider; sohbet yeniden açılınca kart turun cevabının altında görünür; tekrar gönderimde aynı kart gelir, yeni işlem
// açılmaz; düzenlenen önerinin kartı düzenlemeyi isteyen turun altına taşınır. Süre aşımı: sohbet önerisi son
// değişikliğinden 30 dakika sonra EXPIRED görünür, onay, düzenleme ve iptal kalıcı olarak EXPIRED yazıp 409 döner;
// ekrandan açılan işlemin süresi dolmaz. Claude yerine sahte sağlayıcı; araçlar ve kayıtlar gerçek. Her şey sonunda silinir.
import { randomUUID } from 'node:crypto';

import type { MessageContentBlock } from '@ambarci/db';
import {
  apiErrorSchema,
  chatMessageListSchema,
  chatStreamEventSchema,
  conversationSchema,
  operationListSchema,
  operationPreviewSchema,
  operationSchema,
} from '@ambarci/shared';
import type { ChatStreamEvent, Operation } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AIProvider } from '../src/modules/ai/ai-provider.js';
import type { AiToolCall } from '../src/modules/ai/ai-provider.js';
import { aiResult, ScriptedAiProvider } from '../test/support/scripted-ai-provider.js';
import { createStockFixture } from './support/stock-fixture.js';
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

/** Etkin olan olayların türleri; metin parçaları tek bir "text" olarak sayılır. */
function shape(events: ChatStreamEvent[]): string[] {
  return events.map((event) => event.type).filter((type, index, all) => type !== 'text_delta' || all[index - 1] !== 'text_delta');
}

describe('Sohbette işlem kartı ve süre aşımı (gerçek veritabanı)', () => {
  let fx: StockFixture;
  const provider = new ScriptedAiProvider();
  const cable = randomUUID();

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'İşlem kartı', overrides: [{ provide: AIProvider, useValue: provider }] });
    await fx.db.execute(sql`insert into products (id, organization_id, sku, name, base_unit)
      values (${cable}, ${fx.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre')`);
    await fx.db.execute(sql`insert into product_units (organization_id, product_id, unit, factor)
      values (${fx.org}, ${cable}, 'koli', '100')`);
    // Merkez'de 1.000 metre.
    await fx.apply('STOCK_IN', [{ productId: cable, warehouseId: fx.main, quantity: '10', unit: 'koli', unitCost: '1000' }]);
  });

  afterAll(async () => {
    await fx?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  async function openConversation(): Promise<string> {
    return conversationSchema.parse((await fx.call('post', '/v1/conversations').expect(201)).body).id;
  }

  async function send(conversationId: string, clientMessageId: string, text: string): Promise<ChatStreamEvent[]> {
    const response = await streamed(fx.call('post', `/v1/conversations/${conversationId}/messages`).send({ clientMessageId, text })).expect(200);
    return parseEvents(response.body as string);
  }

  /** Modelin bir çıkış önerisi açıp (ya da düzenleyip) kısa bir cevap yazdığı tur. */
  function scriptProposal(quantity: string, operationId?: string): void {
    provider.push(
      toolTurn([
        {
          id: `toolu_${randomUUID()}`,
          name: 'propose_stock_out',
          input: {
            ...(operationId ? { operation_id: operationId } : {}),
            warehouse_id: fx.main,
            lines: [{ product_id: cable, quantity, unit: 'koli' }],
          },
        },
      ]),
      aiResult({ text: "Çıkış önerisi hazır; kartı kontrol edip Onayla'ya bas." }),
    );
  }

  async function proposeInNewChat(quantity: string): Promise<{ conversationId: string; operationId: string; messageId: string }> {
    const conversationId = await openConversation();
    scriptProposal(quantity);
    const events = await send(conversationId, randomUUID(), `Merkezden ${quantity} koli kablo çıkışı yap`);
    const started = events.find((event) => event.type === 'message_started');
    const card = events.find((event) => event.type === 'operation_card');
    if (started?.type !== 'message_started' || card?.type !== 'operation_card') {
      throw new Error('Öneri turu beklenen olayları vermedi.');
    }
    return { conversationId, operationId: card.operationId, messageId: started.messageId };
  }

  async function operationOf(id: string): Promise<Operation> {
    return operationSchema.parse((await fx.call('get', `/v1/operations/${id}`).expect(200)).body);
  }

  async function rowOf(id: string): Promise<{ status: string; sourceMessageId: string | null }> {
    const [row] = await fx.db.execute<{ status: string; sourceMessageId: string | null }>(sql`
      select status, source_message_id as "sourceMessageId" from operations where id = ${id}`);
    if (!row) {
      throw new Error('İşlem bulunamadı.');
    }
    return row;
  }

  /** Önerinin son değişikliğini geriye alır (zaman yolculuğu yerine): süre veritabanının saatiyle denetlenir. */
  async function ageBy(id: string, minutes: number): Promise<void> {
    await fx.db.execute(sql`update operations set updated_at = now() - make_interval(mins => ${minutes}::int) where id = ${id}`);
  }

  async function countOf(query: SQL): Promise<number> {
    const [row] = await fx.db.execute<{ count: number }>(query);
    return row?.count ?? -1;
  }

  async function pendingIds(status = 'PENDING_CONFIRMATION'): Promise<string[]> {
    const response = await fx.call('get', `/v1/operations?status=${status}&pageSize=100`).expect(200);
    return operationListSchema.parse(response.body).items.map((item) => item.id);
  }

  describe('Akış ve geçmiş', () => {
    let conversationId = '';
    let clientMessageId = '';
    let operationId = '';
    let firstMessageId = '';

    it('öneri aracı başarılı olunca araç bitince kart olayı gelir, sonra cevap', async () => {
      conversationId = await openConversation();
      clientMessageId = randomUUID();
      scriptProposal('2');
      const events = await send(conversationId, clientMessageId, 'Merkezden 2 koli kablo çıkışı yap');

      expect(shape(events)).toEqual(['message_started', 'tool_status', 'tool_status', 'operation_card', 'text_delta', 'done']);
      const started = events[0];
      const card = events.find((event) => event.type === 'operation_card');
      firstMessageId = started?.type === 'message_started' ? started.messageId : '';
      operationId = card?.type === 'operation_card' ? card.operationId : '';
      expect(card).toEqual({ type: 'operation_card', operationId, version: 1 });
      expect(await rowOf(operationId)).toEqual({ status: 'PENDING_CONFIRMATION', sourceMessageId: firstMessageId });
    });

    it('sohbet yeniden açılınca kart turun cevabının altında; kullanıcının mesajında kart yok', async () => {
      const { items } = chatMessageListSchema.parse((await fx.call('get', `/v1/conversations/${conversationId}/messages`).expect(200)).body);
      expect(items.map(({ role, operationIds }) => [role, operationIds])).toEqual([
        ['user', []],
        ['assistant', [operationId]],
      ]);
    });

    it('aynı mesajın tekrar gönderimi: model çağrılmaz, yeni işlem açılmaz, aynı kart kayıttan gelir', async () => {
      const calls = provider.requests.length;
      const operationsQuery = sql`select count(*)::int as count from operations where organization_id = ${fx.org}`;
      const before = await countOf(operationsQuery);

      const events = await send(conversationId, clientMessageId, 'Merkezden 2 koli kablo çıkışı yap');

      expect(shape(events)).toEqual(['message_started', 'operation_card', 'text_delta', 'done']);
      expect(events.find((event) => event.type === 'operation_card')).toEqual({ type: 'operation_card', operationId, version: 1 });
      expect(events.at(-1)).toMatchObject({ type: 'done', replayed: true });
      expect(provider.requests.length).toBe(calls);
      expect(await countOf(operationsQuery)).toBe(before);
    });

    it('düzenleme aynı kartı yeni sürümle gönderir; kart düzenlemeyi isteyen turun altına taşınır', async () => {
      scriptProposal('3', operationId);
      const events = await send(conversationId, randomUUID(), 'Hayır, 3 koli olsun');
      const started = events[0];
      const secondMessageId = started?.type === 'message_started' ? started.messageId : '';

      expect(events.find((event) => event.type === 'operation_card')).toEqual({ type: 'operation_card', operationId, version: 2 });
      expect(await rowOf(operationId)).toEqual({ status: 'PENDING_CONFIRMATION', sourceMessageId: secondMessageId });
      const { items } = chatMessageListSchema.parse((await fx.call('get', `/v1/conversations/${conversationId}/messages`).expect(200)).body);
      expect(items.map(({ role, operationIds }) => [role, operationIds])).toEqual([
        ['user', []],
        ['assistant', []],
        ['user', []],
        ['assistant', [operationId]],
      ]);
      expect(secondMessageId).not.toBe(firstMessageId);
    });
  });

  describe('Süre aşımı (30 dakika, yalnızca sohbet önerisi)', () => {
    it('süresi dolan öneri okumada EXPIRED görünür: işlem, önizleme ve liste', async () => {
      const { operationId } = await proposeInNewChat('1');
      expect((await operationOf(operationId)).expiresAt).not.toBeNull();
      await ageBy(operationId, 31);

      const operation = await operationOf(operationId);
      expect(operation.status).toBe('EXPIRED');
      expect(new Date(operation.expiresAt ?? '').getTime()).toBeLessThan(Date.now());
      const preview = operationPreviewSchema.parse((await fx.call('get', `/v1/operations/${operationId}/preview`).expect(200)).body);
      expect(preview).toMatchObject({ status: 'EXPIRED', expiresAt: operation.expiresAt });
      expect(preview.lines.map((line) => line.stock)).toEqual([null]);
      expect(await pendingIds()).not.toContain(operationId);
      expect(await pendingIds('EXPIRED')).toContain(operationId);
      // Okuma durumu yazmaz: kayıtlı durum hâlâ onay bekliyor.
      expect((await rowOf(operationId)).status).toBe('PENDING_CONFIRMATION');
    });

    it('süresi dolan önerinin onayı 409 OPERATION_EXPIRED; durum kalıcı olarak EXPIRED, denetimde kişi boş, stok değişmez', async () => {
      const { operationId } = await proposeInNewChat('1');
      await ageBy(operationId, 31);
      const before = await fx.stockOf(fx.main, cable);

      const response = await fx.confirm({ id: operationId, version: 1 } as Operation).expect(409);
      expect(errorCode(response.body)).toBe('OPERATION_EXPIRED');
      expect((await rowOf(operationId)).status).toBe('EXPIRED');
      const audits = await fx.db.execute<{ actorId: string | null; source: string }>(sql`
        select actor_id as "actorId", source from audit_logs where entity_id = ${operationId} and action = 'operation.expired'`);
      expect(audits).toEqual([{ actorId: null, source: 'CHAT' }]);
      expect(await fx.stockOf(fx.main, cable)).toEqual(before);
      expect(await fx.writtenFor(operationId)).toEqual({ movements: 0, audits: 0, events: 0 });

      // Artık kayıtlı durum EXPIRED: ikinci deneme "onay beklemiyor" alır, süre aşımı ikinci kez yazılmaz.
      expect(errorCode((await fx.confirm({ id: operationId, version: 1 } as Operation).expect(409)).body)).toBe('OPERATION_NOT_PENDING');
      expect(
        await countOf(sql`select count(*)::int as count from audit_logs where entity_id = ${operationId} and action = 'operation.expired'`),
      ).toBe(1);
    });

    it('süresi dolan öneri sohbette düzenlenemez, iptal de edilmez: ikisi de EXPIRED yazar', async () => {
      const revised = await proposeInNewChat('1');
      await ageBy(revised.operationId, 31);
      scriptProposal('2', revised.operationId);
      const events = await send(revised.conversationId, randomUUID(), '2 koli olsun');
      expect(events.some((event) => event.type === 'operation_card')).toBe(false);
      expect(events.find((event) => event.type === 'tool_status' && event.status !== 'started')).toMatchObject({ status: 'failed' });
      expect((await rowOf(revised.operationId)).status).toBe('EXPIRED');

      const cancelled = await proposeInNewChat('1');
      await ageBy(cancelled.operationId, 31);
      const response = await fx.call('post', `/v1/operations/${cancelled.operationId}/cancel`).expect(409);
      expect(errorCode(response.body)).toBe('OPERATION_EXPIRED');
      expect((await rowOf(cancelled.operationId)).status).toBe('EXPIRED');
    });

    it('süresi dolmamış öneri (29. dakika) onaylanır ve stok bir kez değişir', async () => {
      const { operationId } = await proposeInNewChat('1');
      await ageBy(operationId, 29);
      const operation = await operationOf(operationId);
      expect(operation.status).toBe('PENDING_CONFIRMATION');
      expect(new Date(operation.expiresAt ?? '').getTime()).toBeGreaterThan(Date.now());
      await fx.confirm(operation).expect(200);
      expect(await fx.writtenFor(operationId)).toEqual({ movements: 1, audits: 1, events: 1 });
    });

    it('ekrandan açılan işlemin süresi dolmaz: iki saat sonra da onay bekler ve onaylanır', async () => {
      const screen = await fx.open('STOCK_OUT', [{ productId: cable, warehouseId: fx.main, quantity: '1' }]);
      expect(screen.expiresAt).toBeNull();
      await ageBy(screen.id, 120);
      expect(await operationOf(screen.id)).toMatchObject({ status: 'PENDING_CONFIRMATION', expiresAt: null });
      expect(await pendingIds()).toContain(screen.id);
      await fx.confirm(screen).expect(200);
    });
  });
});
