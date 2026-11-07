import { streamChatMessage } from '@ambarci/api-client';
import type { ApiClient, ChatStreamEnd } from '@ambarci/api-client';
import type { ChatStreamEvent, SendMessageInput } from '@ambarci/shared';
import { fetch as expoFetch } from 'expo/fetch';

/**
 * Cevabın gövdesini parça parça okuyabilen fetch. React Native'in eski fetch'i cevabı ancak tamamı gelince verir;
 * expo/fetch akışı verir. Expo 57 genel fetch'i zaten expo/fetch ile değiştiriyor, burada yine de açıkça
 * kullanılıyor ki akış bu ayara bağlı kalmasın (EXPO_PUBLIC_USE_RN_FETCH açılırsa da çalışsın).
 *
 * expo/fetch, tipli istemcinin kurduğu Request nesnesini kabul eder; döndürdüğü yanıt Response'la aynı arayüzü taşır
 * ama TypeScript'te ayrı bir tiptir, o yüzden tip dönüştürülüyor.
 */
function streamingFetch(request: Request): Promise<Response> {
  return expoFetch(request) as unknown as Promise<Response>;
}

/**
 * Mesajı gönderir, cevabın olaylarını geliş sırasıyla `onEvent`e verir ve son olayı (`done` ya da `error`) döner.
 * Hatalar packages/api-client'taki streamChatMessage'da anlatıldığı gibi fırlar.
 */
export function sendChatMessage(
  client: ApiClient,
  conversationId: string,
  message: SendMessageInput,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<ChatStreamEnd> {
  return streamChatMessage(client, { conversationId, message, onEvent, signal, fetch: streamingFetch });
}
