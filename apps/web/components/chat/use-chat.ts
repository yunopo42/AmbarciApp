import {
  ApiRequestError,
  applyChatEvent,
  buildChatRows,
  describeApiError,
  failTurn,
  randomUuid,
  startTurn,
  streamChatMessage,
} from '@ambarci/api-client';
import type { ChatRow, ChatTurn, SavedChatMessage } from '@ambarci/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '@/components/api-provider';
import { errorMessage } from '@/lib/api-client';

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

const NO_MESSAGES: SavedChatMessage[] = [];
const MESSAGES_PATH = '/v1/conversations/{conversationId}/messages';

/**
 * Bir sohbetin mesajları ve mesaj gönderme; mobildeki kancayla aynı kural (apps/mobile/src/chat/use-chat.ts). Turun
 * durumu ve geçmişle birleştirilmesi ortak pakette (packages/api-client/src/chat-turn.ts). `conversationId` null ise
 * yeni sohbettir: sohbet ilk mesajla açılır ve `onConversationCreated` ile bildirilir.
 *
 * Tarayıcının fetch'i cevabın gövdesini parça parça verdiği için akış tipli istemcinin kendi fetch'iyle okunur.
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
  const [turn, setTurn] = useState<ChatTurn | null>(null);

  // Sohbet kimliği ilk mesajla oluşur; aynı gönderimin devamı (akış) yeni kimliği beklemeden kullanabilsin diye
  // ref'te de tutulur.
  const conversationRef = useRef(conversationId);
  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);

  // Başka sohbete geçince ya da şirket değişince akışın okunması durur. Sunucu cevabı yine tamamlayıp kaydeder.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    async (clientMessageId: string, text: string): Promise<void> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (change: (current: ChatTurn) => ChatTurn): void => {
        if (!controller.signal.aborted) {
          setTurn((current) => (current?.clientMessageId === clientMessageId ? change(current) : current));
        }
      };

      setTurn(startTurn(clientMessageId, text));
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

        const end = await streamChatMessage(client, {
          conversationId: id,
          message: { clientMessageId, text },
          onEvent: (event) => patch((current) => applyChatEvent(current, event)),
          signal: controller.signal,
        });

        if (end.type === 'done') {
          void queryClient.invalidateQueries({
            queryKey: $api.queryOptions('get', MESSAGES_PATH, { params: { path: { conversationId: id } } }).queryKey,
          });
          void queryClient.invalidateQueries({ queryKey: ['get', '/v1/conversations'] });
        }
      } catch (error) {
        patch((current) => failTurn(current, describeApiError(error)));
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
  const rows = useMemo(() => buildChatRows(saved, turn), [saved, turn]);

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
