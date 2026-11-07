import { ApiRequestError, describeApiError } from '@ambarci/api-client';
import type { ApiFailure, components } from '@ambarci/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/api/api-provider';
import { errorMessage } from '@/lib/api';
import { randomUuid } from '@/lib/uuid';

import { sendChatMessage } from './stream';

/** Sohbette kayıtlı mesaj: kullanıcının yazdığı ya da asistanın metin cevabı (GET .../messages). */
export type SavedMessage = components['schemas']['ChatMessageDto'];

/** Bu ekrandan gönderilen mesajın durumu: gidiyor, cevap akıyor, cevap geldi, başarısız. */
export type TurnStatus = 'sending' | 'streaming' | 'done' | 'failed';

/**
 * Bu ekrandan gönderilen ve cevabı izlenen mesaj. Cevap gelip sohbetin geçmişi yeniden yüklenince ekrandan çekilir;
 * yerini kayıtlı mesajlar alır.
 */
export interface Turn {
  clientMessageId: string;
  text: string;
  /** Akan cevap; `done` gelince cevabın tamamıyla değiştirilir. */
  answer: string;
  /** Çalışan aracın etiketi ("Ürün aranıyor"); araç çalışmıyorsa null. */
  tool: string | null;
  status: TurnStatus;
  error: ApiFailure | null;
}

/** Sohbet ekranının bir satırı, eskiden yeniye. */
export type ChatRow =
  | {
      kind: 'message';
      message: SavedMessage;
      /** Son kullanıcı mesajının cevabı başarısız olduysa tekrar gönderilebilir; hâlâ sürüyorsa beklenir. */
      note: 'failed' | 'in_progress' | null;
    }
  | { kind: 'turn'; turn: Turn };

export interface ChatState {
  rows: ChatRow[];
  isLoading: boolean;
  loadError: string | null;
  reload: () => void;
  /** Bir mesaj gidiyor ya da cevabı akıyor; bu sırada yeni mesaj gönderilmez (sunucu da 409 verir). */
  busy: boolean;
  send: (text: string) => void;
  /** Başarısız olan mesajı aynı istemci kimliğiyle tekrar gönderir. */
  retry: (clientMessageId: string, text: string) => void;
}

const NO_MESSAGES: SavedMessage[] = [];
const MESSAGES_PATH = '/v1/conversations/{conversationId}/messages';

/**
 * Bir sohbetin mesajları ve mesaj gönderme. `conversationId` null ise yeni sohbettir: sohbet ilk mesajla açılır ve
 * `onConversationCreated` ile bildirilir.
 *
 * Tekrar gönderme kuralı (#57): her mesaja bir istemci kimliği verilir ve ağ hatasında aynı kimlikle tekrar
 * gönderilir. Cevap sunucuda tamamlanmışsa kaydedilen cevap gelir, model ikinci kez çağrılmaz.
 */
export function useChat(conversationId: string | null, onConversationCreated: (id: string) => void): ChatState {
  const { client, $api } = useApi();
  const queryClient = useQueryClient();
  const history = $api.useQuery(
    'get',
    MESSAGES_PATH,
    { params: { path: { conversationId: conversationId ?? '' } } },
    { enabled: conversationId !== null },
  );
  const [turn, setTurn] = useState<Turn | null>(null);

  // Sohbet kimliği ilk mesajla oluşur; aynı gönderimin devamı (akış) yeni kimliği beklemeden kullanabilsin diye
  // ref'te de tutulur.
  const conversationRef = useRef(conversationId);
  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);

  // Ekrandan çıkınca (ya da başka sohbete geçince) akışın okunması durur. Sunucu cevabı yine tamamlayıp kaydeder;
  // sohbete dönülünce kayıtlı cevap görünür.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (clientMessageId: string, text: string): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // Yalnızca bu gönderimin turunu günceller; iptal edildiyse (yeni gönderim, ekrandan çıkış) dokunmaz.
      const patch = (change: (current: Turn) => Turn): void => {
        if (!controller.signal.aborted) {
          setTurn((current) => (current?.clientMessageId === clientMessageId ? change(current) : current));
        }
      };

      setTurn({ clientMessageId, text, answer: '', tool: null, status: 'sending', error: null });
      try {
        let id = conversationRef.current;
        if (!id) {
          const { data, error, response } = await client.POST('/v1/conversations');
          if (!data) {
            throw new ApiRequestError(describeApiError(error), response.status);
          }
          id = data.id;
          conversationRef.current = id;
          onConversationCreated(id);
        }

        const end = await sendChatMessage(
          client,
          id,
          { clientMessageId, text },
          (event) => {
            if (event.type === 'message_started') {
              patch((current) => ({ ...current, status: 'streaming' }));
            } else if (event.type === 'tool_status') {
              patch((current) => ({ ...current, status: 'streaming', tool: event.status === 'started' ? event.label : null }));
            } else if (event.type === 'text_delta') {
              patch((current) => ({ ...current, status: 'streaming', tool: null, answer: current.answer + event.text }));
            }
          },
          controller.signal,
        );

        if (end.type === 'done') {
          patch((current) => ({ ...current, status: 'done', tool: null, answer: end.text }));
          // Geçmiş yeniden yüklenince tur ekrandan çekilir (rows); sohbet listesinde başlık ve sıra güncellenir.
          void queryClient.invalidateQueries({
            queryKey: $api.queryOptions('get', MESSAGES_PATH, { params: { path: { conversationId: id } } }).queryKey,
          });
          void queryClient.invalidateQueries({ queryKey: ['get', '/v1/conversations'] });
        } else {
          patch((current) => ({ ...current, status: 'failed', tool: null, error: { code: end.code, message: end.message } }));
        }
      } catch (error) {
        patch((current) => ({ ...current, status: 'failed', tool: null, error: describeApiError(error) }));
      }
    },
    [client, $api, queryClient, onConversationCreated],
  );

  const busy = turn?.status === 'sending' || turn?.status === 'streaming';

  const send = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (trimmed && !busy) {
        void run(randomUuid(), trimmed);
      }
    },
    [busy, run],
  );

  const retry = useCallback(
    (clientMessageId: string, text: string): void => {
      if (!busy) {
        void run(clientMessageId, text);
      }
    },
    [busy, run],
  );

  const saved = history.data?.items ?? NO_MESSAGES;
  const rows = useMemo(() => buildRows(saved, turn), [saved, turn]);

  return {
    rows,
    isLoading: conversationId !== null && history.isPending,
    loadError: history.isError ? errorMessage(history.error) : null,
    reload: () => void history.refetch(),
    busy,
    send,
    retry,
  };
}

/**
 * Kayıtlı mesajlarla bu ekranın turunu birleştirir. Tur sürerken (ya da cevabı geldiği hâlde geçmiş henüz
 * yenilenmemişken) o mesaj ve sonrası turdan gösterilir; geçmiş cevabı içerince tur çekilir.
 */
export function buildRows(saved: SavedMessage[], turn: Turn | null): ChatRow[] {
  const settled =
    turn?.status === 'done' &&
    saved.some((message) => message.clientMessageId === turn.clientMessageId && message.status === 'COMPLETED');
  const active = turn && !settled ? turn : null;
  const cut = active ? saved.findIndex((message) => message.clientMessageId === active.clientMessageId) : -1;
  const visible = cut === -1 ? saved : saved.slice(0, cut);

  let lastUser: SavedMessage | null = null;
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
