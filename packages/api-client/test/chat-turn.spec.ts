import type { ChatStreamEvent } from '@ambarci/shared';
import { describe, expect, it } from 'vitest';

import { applyChatEvent, buildChatRows, failTurn, randomUuid, startTurn, turnStatusLabel } from '../src/index.js';
import type { ChatTurn, SavedChatMessage } from '../src/index.js';

// Sohbet ekranının ortak durumu (mobil ve web): olayların tura işlenmesi, kayıtlı geçmişle birleştirme ve tekrar
// gönderilebilecek mesajın seçimi.

const MESSAGE = '6a3f2c10-4b1e-4c8a-9d2e-0a0b0c0d0e04';

let sequence = 0;
function saved(role: SavedChatMessage['role'], text: string, extra: Partial<SavedChatMessage> = {}): SavedChatMessage {
  sequence += 1;
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    role,
    text,
    status: role === 'user' ? 'COMPLETED' : null,
    clientMessageId: role === 'user' ? randomUuid() : null,
    createdAt: new Date(Date.UTC(2026, 10, 7, 9, sequence)).toISOString(),
    ...extra,
  };
}

function play(turn: ChatTurn, events: ChatStreamEvent[]): ChatTurn[] {
  const states: ChatTurn[] = [];
  let current = turn;
  for (const event of events) {
    current = applyChatEvent(current, event);
    states.push(current);
  }
  return states;
}

describe('Turun olayları', () => {
  it('metin parçaları eklenir, araç etiketi araç bitince kalkar, done cevabın tamamıyla değiştirir', () => {
    const turn = startTurn(randomUuid(), 'Merkezde NYM kaç metre?');
    expect(turnStatusLabel(turn)).toBe('Gönderiliyor… Sunucu uykudaysa ilk cevap bir dakika sürebilir.');

    const states = play(turn, [
      { type: 'message_started', messageId: MESSAGE, clientMessageId: turn.clientMessageId },
      { type: 'tool_status', tool: 'search_products', label: 'Ürün aranıyor', status: 'started' },
      { type: 'tool_status', tool: 'search_products', label: 'Ürün aranıyor', status: 'succeeded' },
      { type: 'text_delta', text: 'Merkez Depo’da ' },
      { type: 'text_delta', text: '1.200 metre' },
      { type: 'done', messageId: MESSAGE, text: 'Merkez Depo’da 1.200 metre var.', replayed: false },
    ]);

    expect(states.map((state) => turnStatusLabel(state))).toEqual([
      'Cevap hazırlanıyor…',
      'Ürün aranıyor…',
      'Cevap hazırlanıyor…',
      null,
      null,
      null,
    ]);
    expect(states[4]?.answer).toBe('Merkez Depo’da 1.200 metre');
    expect(states[5]).toMatchObject({ status: 'done', answer: 'Merkez Depo’da 1.200 metre var.', tool: null, error: null });
  });

  it('error olayı ve istek hatası turu başarısız yapar; mesaj ve istemci kimliği korunur', () => {
    const turn = startTurn(randomUuid(), 'priz');
    const failed = applyChatEvent(turn, { type: 'error', code: 'AI_UNAVAILABLE', message: 'Asistan şu an cevap veremiyor.' });
    expect(failed).toMatchObject({ status: 'failed', clientMessageId: turn.clientMessageId, text: 'priz' });
    expect(failed.error).toEqual({ code: 'AI_UNAVAILABLE', message: 'Asistan şu an cevap veremiyor.' });

    const network = failTurn({ ...turn, status: 'streaming', tool: 'Stok sorgulanıyor' }, { code: 'NETWORK_ERROR', message: 'Ulaşılamadı.' });
    expect(network).toMatchObject({ status: 'failed', tool: null, error: { code: 'NETWORK_ERROR' } });
    expect(turnStatusLabel(network)).toBeNull();
  });
});

describe('Kayıtlı geçmiş ve tur', () => {
  it('tur yokken yalnızca son kullanıcı mesajına not düşülür', () => {
    const olderFailed = saved('user', 'eski', { status: 'FAILED' });
    const answer = saved('assistant', 'cevap');
    const lastFailed = saved('user', 'son', { status: 'FAILED' });
    const rows = buildChatRows([olderFailed, answer, lastFailed], null);
    expect(rows.map((row) => (row.kind === 'message' ? row.note : 'turn'))).toEqual([null, null, 'failed']);

    const inProgress = saved('user', 'sürüyor', { status: 'IN_PROGRESS' });
    expect(buildChatRows([answer, inProgress], null).at(-1)).toMatchObject({ note: 'in_progress' });
  });

  it('tur sürerken onun kayıtlı mesajı ve sonrası gösterilmez, tur en sonda durur', () => {
    const first = saved('user', 'ilk');
    const firstAnswer = saved('assistant', 'ilk cevap');
    const turn = { ...startTurn(randomUuid(), 'ikinci'), status: 'streaming' as const, answer: 'yarı' };
    const pending = saved('user', 'ikinci', { status: 'IN_PROGRESS', clientMessageId: turn.clientMessageId });

    const rows = buildChatRows([first, firstAnswer, pending], turn);
    expect(rows.map((row) => row.kind)).toEqual(['message', 'message', 'turn']);
    expect(rows[2]).toEqual({ kind: 'turn', turn });
    expect(rows.slice(0, 2).every((row) => row.kind === 'message' && row.note === null)).toBe(true);
  });

  it('cevap gelen tur, geçmiş cevabı içerene kadar kalır; içerince yerini kayıtlı mesajlara bırakır', () => {
    const turn = { ...startTurn(randomUuid(), 'soru'), status: 'done' as const, answer: 'cevap' };
    const stale = [saved('user', 'soru', { status: 'IN_PROGRESS', clientMessageId: turn.clientMessageId })];
    expect(buildChatRows(stale, turn).map((row) => row.kind)).toEqual(['turn']);

    const fresh = [saved('user', 'soru', { clientMessageId: turn.clientMessageId }), saved('assistant', 'cevap')];
    expect(buildChatRows(fresh, turn).map((row) => row.kind)).toEqual(['message', 'message']);
  });

  it('başarısız tur, geçmişteki başarısız kaydın yerine gösterilir', () => {
    const turn = failTurn(startTurn(randomUuid(), 'soru'), { code: 'STREAM_INTERRUPTED', message: 'Bağlantı koptu.' });
    const rows = buildChatRows([saved('user', 'soru', { status: 'FAILED', clientMessageId: turn.clientMessageId })], turn);
    expect(rows).toEqual([{ kind: 'turn', turn }]);
  });
});

describe('İstemci kimliği', () => {
  it('UUID v4 biçiminde ve her çağrıda farklı; crypto.randomUUID yoksa da', () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const ids = new Set(Array.from({ length: 100 }, () => randomUuid()));
      expect(ids.size).toBe(100);
      expect([...ids].every((id) => pattern.test(id))).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'crypto', original);
      }
    }
    expect(randomUuid()).toMatch(pattern);
  });
});
