import type { ChatStreamEvent } from '@ambarci/shared';

import type { ApiFailure } from './errors.js';
import type { components } from './schema.js';

// Sohbet ekranının durumu, mobil (#58) ve web (#59) için ortak: gönderilen mesajın turu, akan olayların tura
// işlenmesi ve kayıtlı geçmişle birleştirilmesi. React'ten bağımsızdır; her uygulama kendi kancasında kullanır.

/** Sohbette kayıtlı mesaj: kullanıcının yazdığı ya da asistanın metin cevabı (GET .../messages). */
export type SavedChatMessage = components['schemas']['ChatMessageDto'];

/** Bu ekrandan gönderilen mesajın durumu: gidiyor, cevap akıyor, cevap geldi, başarısız. */
export type ChatTurnStatus = 'sending' | 'streaming' | 'done' | 'failed';

/**
 * Bu ekrandan gönderilen ve cevabı izlenen mesaj. Cevap gelip sohbetin geçmişi yeniden yüklenince ekrandan çekilir;
 * yerini kayıtlı mesajlar alır.
 */
export interface ChatTurn {
  clientMessageId: string;
  text: string;
  /** Akan cevap; `done` gelince cevabın tamamıyla değiştirilir. */
  answer: string;
  /** Çalışan aracın etiketi ("Ürün aranıyor"); araç çalışmıyorsa null. */
  tool: string | null;
  status: ChatTurnStatus;
  error: ApiFailure | null;
}

/** Sohbet ekranının bir satırı, eskiden yeniye. */
export type ChatRow =
  | {
      kind: 'message';
      message: SavedChatMessage;
      /** Son kullanıcı mesajının cevabı başarısız olduysa tekrar gönderilebilir; hâlâ sürüyorsa beklenir. */
      note: 'failed' | 'in_progress' | null;
    }
  | { kind: 'turn'; turn: ChatTurn };

/** Yeni gönderim (ya da aynı kimlikle tekrar gönderim) için boş tur. */
export function startTurn(clientMessageId: string, text: string): ChatTurn {
  return { clientMessageId, text, answer: '', tool: null, status: 'sending', error: null };
}

/** Akıştan gelen olayı tura işler. */
export function applyChatEvent(turn: ChatTurn, event: ChatStreamEvent): ChatTurn {
  switch (event.type) {
    case 'message_started':
      return { ...turn, status: 'streaming' };
    case 'tool_status':
      return { ...turn, status: 'streaming', tool: event.status === 'started' ? event.label : null };
    case 'text_delta':
      return { ...turn, status: 'streaming', tool: null, answer: turn.answer + event.text };
    case 'done':
      return { ...turn, status: 'done', tool: null, answer: event.text, error: null };
    case 'error':
      return { ...turn, status: 'failed', tool: null, error: { code: event.code, message: event.message } };
  }
}

/** İstek ya da akış hata verdi (ağ, 409, kopan akış): tur başarısız, mesaj aynı kimlikle tekrar gönderilebilir. */
export function failTurn(turn: ChatTurn, failure: ApiFailure): ChatTurn {
  return { ...turn, status: 'failed', tool: null, error: failure };
}

/** Tur sürerken gösterilen durum satırı; gösterilecek bir şey yoksa null. */
export function turnStatusLabel(turn: ChatTurn): string | null {
  if (turn.status === 'sending') {
    return 'Gönderiliyor… Sunucu uykudaysa ilk cevap bir dakika sürebilir.';
  }
  if (turn.status === 'streaming') {
    if (turn.tool) {
      return `${turn.tool}…`;
    }
    return turn.answer ? null : 'Cevap hazırlanıyor…';
  }
  return null;
}

/**
 * Kayıtlı mesajlarla ekranın turunu birleştirir. Tur sürerken (ya da cevabı geldiği hâlde geçmiş henüz
 * yenilenmemişken) o mesaj ve sonrası turdan gösterilir; geçmiş cevabı içerince tur çekilir. Geçmişte son kullanıcı
 * mesajının cevabı başarısız ya da hâlâ sürüyorsa not düşülür; daha eski mesajlara düşülmez, çünkü onlar sonradan
 * cevaplanırsa sohbetin sırası bozulur.
 */
export function buildChatRows(saved: SavedChatMessage[], turn: ChatTurn | null): ChatRow[] {
  const settled =
    turn?.status === 'done' &&
    saved.some((message) => message.clientMessageId === turn.clientMessageId && message.status === 'COMPLETED');
  const active = turn && !settled ? turn : null;
  const cut = active ? saved.findIndex((message) => message.clientMessageId === active.clientMessageId) : -1;
  const visible = cut === -1 ? saved : saved.slice(0, cut);

  let lastUser: SavedChatMessage | null = null;
  for (const message of visible) {
    if (message.role === 'user') {
      lastUser = message;
    }
  }
  const rows: ChatRow[] = visible.map((message) => ({
    kind: 'message',
    message,
    note:
      active || message !== lastUser
        ? null
        : message.status === 'FAILED'
          ? 'failed'
          : message.status === 'IN_PROGRESS'
            ? 'in_progress'
            : null,
  }));
  if (active) {
    rows.push({ kind: 'turn', turn: active });
  }
  return rows;
}

/**
 * UUID (sürüm 4): mesajın istemci kimliği (`clientMessageId`). Gizli bir değer değil, tekrar gönderimi tanımaya
 * yarayan bir anahtar ve yalnızca kendi sohbetinde benzersiz olması gerekir. crypto.randomUUID varsa o kullanılır;
 * React Native'de (Hermes) ve güvenli olmayan (http) sayfalarda yoktur, o zaman Math.random ile üretilir. 122
 * rastgele bitle aynı sohbette çakışma olasılığı yok sayılacak kadar küçük; bunun için paket eklenmedi.
 */
export function randomUuid(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof native?.randomUUID === 'function') {
    return native.randomUUID();
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // sürüm 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 varyantı
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
