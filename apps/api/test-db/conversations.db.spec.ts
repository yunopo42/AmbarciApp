// Sohbet uçları ve cevabın akışı (SSE) gerçek veritabanında. Claude yerine sahte sağlayıcı kullanılır; araçlar ve
// kayıtlar gerçek. Olay sırası, mesajların kaydı, tekrar gönderim, sürmekte olan ve yarıda kalmış cevap, model hatası,
// sohbet sahipliği ve istemcinin kopması denetlenir. Oluşturulan her şey sonunda silinir.
import { randomUUID } from 'node:crypto';

import type { MessageContentBlock } from '@ambarci/db';
import { apiErrorSchema, chatMessageListSchema, chatStreamEventSchema, conversationListSchema, conversationSchema } from '@ambarci/shared';
import type { ChatStreamEvent, Conversation } from '@ambarci/shared';
import { sql } from 'drizzle-orm';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AIProvider, AiProviderError } from '../src/modules/ai/ai-provider.js';
import type { AiToolCall } from '../src/modules/ai/ai-provider.js';
import { ConversationsService } from '../src/modules/assistant/conversations.service.js';
import type { ChatStreamSink } from '../src/modules/assistant/conversations.service.js';
import type { OrganizationContext } from '../src/modules/organizations/organization-context.js';
import { aiResult, ScriptedAiProvider } from '../test/support/scripted-ai-provider.js';
import { createStockFixture } from './support/stock-fixture.js';
import type { StockFixture } from './support/stock-fixture.js';

/** SSE gövdesini olaylara ayırır; ": ping" yorum satırları atlanır, "event" satırı veriyle tutarlı olmalı. */
function parseEvents(body: string): ChatStreamEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block !== '' && !block.startsWith(':'))
    .map((block) => {
      const lines = block.split('\n');
      const event = chatStreamEventSchema.parse(JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice(6) ?? ''));
      expect(lines[0]).toBe(`event: ${event.type}`);
      return event;
    });
}

/** Supertest akışın tamamını metin olarak toplasın (text/event-stream için varsayılan ayrıştırıcı yok). */
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

describe('Sohbet uçları ve akış (gerçek veritabanı)', () => {
  let fx: StockFixture;
  let other: StockFixture;
  let employee = '';
  const provider = new ScriptedAiProvider();

  beforeAll(async () => {
    fx = await createStockFixture({ label: 'Sohbet', overrides: [{ provide: AIProvider, useValue: provider }] });
    other = await createStockFixture({ label: 'Sohbet B' });
    employee = await fx.addMember('EMPLOYEE');
    await fx.db.execute(sql`insert into products (organization_id, sku, name, base_unit)
      values (${fx.org}, 'KBL-NYM-25', 'NYM kablo 3x2,5 mm²', 'metre')`);
  });

  afterAll(async () => {
    await fx?.close();
    await other?.close();
  });

  const errorCode = (body: unknown): string => apiErrorSchema.parse(body).error.code;

  async function openConversation(userId: string = fx.admin): Promise<Conversation> {
    const response = await fx.call('post', '/v1/conversations', userId).expect(201);
    return conversationSchema.parse(response.body);
  }

  async function send(conversationId: string, body: { clientMessageId: string; text: string }): Promise<ChatStreamEvent[]> {
    const response = await streamed(fx.call('post', `/v1/conversations/${conversationId}/messages`).send(body)).expect(200);
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    return parseEvents(response.body as string);
  }

  async function messagesOf(conversationId: string): Promise<{ role: string; status: string | null; position: number }[]> {
    return fx.db.execute<{ role: string; status: string | null; position: number }>(sql`
      select role, status, position from messages where conversation_id = ${conversationId} order by position`);
  }

  it('yeni sohbet açılır ve sahibinin listesinde görünür; aynı şirketteki başka kullanıcı görmez', async () => {
    const conversation = await openConversation();
    expect(conversation.title).toBeNull();
    const own = conversationListSchema.parse((await fx.call('get', '/v1/conversations').expect(200)).body);
    expect(own.items.map((item) => item.id)).toContain(conversation.id);
    const theirs = conversationListSchema.parse((await fx.call('get', '/v1/conversations', employee).expect(200)).body);
    expect(theirs.items.map((item) => item.id)).not.toContain(conversation.id);
  });

  it('mesajın cevabı akar: olay sırası, mesajlar sırasıyla kaydedilir, başlık konur, model çağrıları mesaja bağlanır', async () => {
    const conversation = await openConversation();
    provider.push(
      toolTurn([{ id: 'toolu_1', name: 'search_products', input: { query: 'nym kablo 3x2,5' } }]),
      aiResult({ text: 'NYM kablo 3x2,5 mm² (KBL-NYM-25) için stok bilgisi yok.' }),
    );
    const clientMessageId = randomUUID();
    const events = await send(conversation.id, { clientMessageId, text: '  Merkezde NYM 3x2,5 kaç metre?  ' });

    expect(events.map((event) => event.type)).toEqual([
      'message_started',
      'tool_status',
      'tool_status',
      ...Array<string>(events.length - 4).fill('text_delta'),
      'done',
    ]);
    const [started, toolStarted, toolDone] = events;
    expect(started).toMatchObject({ type: 'message_started', clientMessageId });
    expect(toolStarted).toEqual({ type: 'tool_status', tool: 'search_products', label: 'Ürün aranıyor', status: 'started' });
    expect(toolDone).toMatchObject({ status: 'succeeded' });
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', text: 'NYM kablo 3x2,5 mm² (KBL-NYM-25) için stok bilgisi yok.', replayed: false });
    const deltas = events.flatMap((event) => (event.type === 'text_delta' ? [event.text] : []));
    expect(deltas.join('')).toBe(done?.type === 'done' ? done.text : '');

    expect(await messagesOf(conversation.id)).toEqual([
      { role: 'USER', status: 'COMPLETED', position: 1 },
      { role: 'ASSISTANT', status: null, position: 2 },
      { role: 'TOOL', status: null, position: 3 },
      { role: 'ASSISTANT', status: null, position: 4 },
    ]);
    const messageId = started?.type === 'message_started' ? started.messageId : '';
    const [runs] = await fx.db.execute<{ count: number }>(sql`select count(*)::int from ai_runs where message_id = ${messageId}`);
    expect(runs?.count).toBe(2);

    const [listed] = conversationListSchema.parse((await fx.call('get', '/v1/conversations').expect(200)).body).items.filter(
      (item) => item.id === conversation.id,
    );
    expect(listed?.title).toBe('Merkezde NYM 3x2,5 kaç metre?');

    // Ekranda yalnızca kullanıcının mesajı ve asistanın metin cevabı görünür.
    const visible = chatMessageListSchema.parse((await fx.call('get', `/v1/conversations/${conversation.id}/messages`).expect(200)).body);
    expect(visible.items.map(({ role, text, status }) => ({ role, text, status }))).toEqual([
      { role: 'user', text: 'Merkezde NYM 3x2,5 kaç metre?', status: 'COMPLETED' },
      { role: 'assistant', text: 'NYM kablo 3x2,5 mm² (KBL-NYM-25) için stok bilgisi yok.', status: null },
    ]);

    // Aynı kimlikle tekrar: model çağrılmaz, kayıtlı cevap döner, yeni mesaj yazılmaz.
    const requestsBefore = provider.requests.length;
    const replay = await send(conversation.id, { clientMessageId, text: 'metin farklı olsa da kimlik aynı' });
    expect(replay.map((event) => event.type)).toEqual(['message_started', 'text_delta', 'done']);
    expect(replay.at(-1)).toMatchObject({ type: 'done', messageId, replayed: true, text: 'NYM kablo 3x2,5 mm² (KBL-NYM-25) için stok bilgisi yok.' });
    expect(provider.requests.length).toBe(requestsBefore);
    expect(await messagesOf(conversation.id)).toHaveLength(4);
  });

  it('cevabı süren mesaj tekrar gelirse 409 MESSAGE_IN_PROGRESS; sohbette cevap sürerken yeni mesaj 409 CONVERSATION_BUSY', async () => {
    const conversation = await openConversation();
    const stuck = randomUUID();
    await fx.db.execute(sql`insert into messages (organization_id, conversation_id, user_id, position, role, content, client_message_id, status)
      values (${fx.org}, ${conversation.id}, ${fx.admin}, 1, 'USER', '[{"type":"text","text":"Ostim?"}]'::jsonb, ${stuck}, 'IN_PROGRESS')`);
    await fx.db.execute(sql`update conversations set updated_at = now() where id = ${conversation.id}`);
    const path = `/v1/conversations/${conversation.id}/messages`;

    const same = await fx.call('post', path).send({ clientMessageId: stuck, text: 'Ostim?' }).expect(409);
    expect(errorCode(same.body)).toBe('MESSAGE_IN_PROGRESS');
    const another = await fx.call('post', path).send({ clientMessageId: randomUUID(), text: 'Araçta?' }).expect(409);
    expect(errorCode(another.body)).toBe('CONVERSATION_BUSY');

    // Sohbet 5 dakikadan uzun süredir hareketsizse cevap yarıda kalmış sayılır: aynı mesaj yeniden cevaplanır.
    await fx.db.execute(sql`update conversations set updated_at = now() - interval '6 minutes' where id = ${conversation.id}`);
    provider.push(aiResult({ text: 'Ostim’de stok yok.' }));
    const retried = await send(conversation.id, { clientMessageId: stuck, text: 'Ostim?' });
    expect(retried.at(-1)).toMatchObject({ type: 'done', text: 'Ostim’de stok yok.', replayed: false });
    expect(await messagesOf(conversation.id)).toEqual([
      { role: 'USER', status: 'COMPLETED', position: 1 },
      { role: 'ASSISTANT', status: null, position: 2 },
    ]);
  });

  it('model hatası akışta error olayıyla döner, mesaj başarısız kalır; aynı kimlikle tekrar gönderilince cevap üretilir', async () => {
    const conversation = await openConversation();
    const clientMessageId = randomUUID();
    provider.push(new AiProviderError('AI_OVERLOADED', 'Claude API aşırı yüklü (529).', 40));
    const failed = await send(conversation.id, { clientMessageId, text: 'Priz kaç adet?' });
    expect(failed.map((event) => event.type)).toEqual(['message_started', 'error']);
    expect(failed[1]).toMatchObject({ type: 'error', code: 'AI_OVERLOADED' });
    expect(await messagesOf(conversation.id)).toEqual([{ role: 'USER', status: 'FAILED', position: 1 }]);

    provider.push(aiResult({ text: 'Hangi prizi soruyorsunuz?' }));
    const retried = await send(conversation.id, { clientMessageId, text: 'Priz kaç adet?' });
    expect(retried.at(-1)).toMatchObject({ type: 'done', text: 'Hangi prizi soruyorsunuz?', replayed: false });
    expect(await messagesOf(conversation.id)).toEqual([
      { role: 'USER', status: 'COMPLETED', position: 1 },
      { role: 'ASSISTANT', status: null, position: 2 },
    ]);
  });

  it('başka kullanıcının ve başka şirketin sohbeti bulunamadı (404) görünür', async () => {
    const conversation = await openConversation();
    const path = `/v1/conversations/${conversation.id}/messages`;
    expect(errorCode((await fx.call('get', path, employee).expect(404)).body)).toBe('CONVERSATION_NOT_FOUND');
    const byEmployee = await fx.call('post', path, employee).send({ clientMessageId: randomUUID(), text: 'merhaba' }).expect(404);
    expect(errorCode(byEmployee.body)).toBe('CONVERSATION_NOT_FOUND');
    expect(errorCode((await other.call('get', path).expect(404)).body)).toBe('CONVERSATION_NOT_FOUND');
    const byOther = await other.call('post', path).send({ clientMessageId: randomUUID(), text: 'merhaba' }).expect(404);
    expect(errorCode(byOther.body)).toBe('CONVERSATION_NOT_FOUND');
  });

  it('istemci bağlantıyı kapatsa da cevap tamamlanır ve kaydedilir', async () => {
    const conversation = await openConversation();
    const service = fx.app.get(ConversationsService, { strict: false });
    const [membership] = await fx.db.execute<{ id: string }>(sql`
      select id from organization_users where organization_id = ${fx.org} and user_id = ${fx.admin}`);
    const organization: OrganizationContext = { id: fx.org, role: 'ADMIN', membershipId: membership?.id ?? '' };
    // Kopmuş istemci: hiçbir olayı okumaz.
    const gone: ChatStreamSink = { open: () => undefined, send: () => undefined, close: () => undefined };

    provider.push(toolTurn([{ id: 'toolu_9', name: 'list_warehouses', input: {} }]), aiResult({ text: 'İki depo var.' }));
    await service.send(organization, fx.admin, conversation.id, { clientMessageId: randomUUID(), text: 'Hangi depolar var?' }, gone);

    expect(await messagesOf(conversation.id)).toEqual([
      { role: 'USER', status: 'COMPLETED', position: 1 },
      { role: 'ASSISTANT', status: null, position: 2 },
      { role: 'TOOL', status: null, position: 3 },
      { role: 'ASSISTANT', status: null, position: 4 },
    ]);
  });
});
