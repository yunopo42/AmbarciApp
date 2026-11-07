'use client';

import { randomUuid } from '@ambarci/api-client';
import type { ChatRow } from '@ambarci/api-client';
import { ArrowLeft, History, SquarePen, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

import { CHAT_INPUT_ID, ChatComposer } from '@/components/chat/chat-composer';
import { ChatRowView, EmptyChat } from '@/components/chat/chat-rows';
import { ConversationList } from '@/components/chat/conversation-list';
import { useChat } from '@/components/chat/use-chat';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const CHAT_PANEL_ID = 'chat-panel';

/**
 * Açık sohbet. `key` yalnızca kullanıcı başka sohbet seçince ya da yeni sohbete geçince değişir ve sohbeti baştan
 * kurar; yeni sohbet ilk mesajla oluşunca kimlik eklenir ama `key` aynı kalır, akan cevap kesilmez (mobilde de aynı).
 */
interface ChatSession {
  key: string;
  conversationId: string | null;
}

/**
 * Panelin her sayfasında açılıp kapanan asistan paneli. Sağda sabit durur ve sayfayı kapatmaz (modal değil):
 * kullanıcı stok listesine bakarken soru sorabilir. Kapatılınca gizlenir ama kurulu kalır; açık sohbet ve akan cevap
 * sayfa değişse de sürer. Şirket değişince şirket katmanıyla birlikte baştan kurulur ve o şirketin sohbetlerini
 * gösterir (organization-provider.tsx).
 */
export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [session, setSession] = useState<ChatSession>(() => ({ key: randomUuid(), conversationId: null }));
  const [view, setView] = useState<'chat' | 'list'>('chat');

  const handleCreated = useCallback((conversationId: string) => {
    setSession((current) => ({ ...current, conversationId }));
  }, []);

  // Panel açılınca ya da sohbete dönülünce imleç mesaj kutusuna gider.
  useEffect(() => {
    if (open && view === 'chat') {
      document.getElementById(CHAT_INPUT_ID)?.focus();
    }
  }, [open, view, session.key]);

  return (
    <aside
      id={CHAT_PANEL_ID}
      aria-label="Asistan"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
        }
      }}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border-strong bg-canvas shadow-2 sm:w-96',
        !open && 'hidden',
      )}
    >
      <header className="flex items-center gap-1 border-b border-border bg-card px-4 py-2">
        {view === 'list' ? (
          <Button variant="ghost" size="sm" onClick={() => setView('chat')}>
            <ArrowLeft aria-hidden />
            Sohbete dön
          </Button>
        ) : (
          <h2 className="text-headline-sm text-text">Asistan</h2>
        )}
        <div className="ml-auto flex items-center gap-1">
          {view === 'chat' ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setView('list')}>
                <History aria-hidden />
                Sohbetler
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Yeni sohbet"
                title="Yeni sohbet"
                onClick={() => setSession({ key: randomUuid(), conversationId: null })}
              >
                <SquarePen aria-hidden />
              </Button>
            </>
          ) : null}
          <Button variant="ghost" size="sm" aria-label="Asistanı kapat" title="Kapat" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
      </header>

      {view === 'list' ? (
        <ConversationList
          currentId={session.conversationId}
          onSelect={(conversationId) => {
            setSession((current) => (current.conversationId === conversationId ? current : { key: conversationId, conversationId }));
            setView('chat');
          }}
          onNew={() => {
            setSession({ key: randomUuid(), conversationId: null });
            setView('chat');
          }}
        />
      ) : null}
      {/* Liste açıkken sohbet gizlenir ama kurulu kalır: akan cevap kesilmez. */}
      <div className={cn('flex min-h-0 flex-1 flex-col', view !== 'chat' && 'hidden')}>
        <ChatView key={session.key} conversationId={session.conversationId} onConversationCreated={handleCreated} />
      </div>
    </aside>
  );
}

function rowKey(row: ChatRow): string {
  return row.kind === 'message' ? row.message.id : `turn-${row.turn.clientMessageId}`;
}

function ChatView({
  conversationId,
  onConversationCreated,
}: {
  conversationId: string | null;
  onConversationCreated: (conversationId: string) => void;
}): JSX.Element {
  const chat = useChat(conversationId, onConversationCreated);
  const [draft, setDraft] = useState('');

  function handleSend(): void {
    if (chat.busy || !draft.trim()) {
      return;
    }
    chat.send(draft);
    setDraft('');
  }

  let content: JSX.Element;
  if (chat.isLoading) {
    content = (
      <p aria-live="polite" className="text-body-md text-text-muted">
        Sohbet yükleniyor…
      </p>
    );
  } else if (chat.loadError && chat.rows.length === 0) {
    content = (
      <div className="flex flex-col items-start gap-2">
        <Alert>{chat.loadError}</Alert>
        <Button variant="secondary" size="sm" onClick={chat.reload}>
          Tekrar dene
        </Button>
      </div>
    );
  } else if (chat.rows.length === 0) {
    content = <EmptyChat />;
  } else {
    content = (
      <>
        {chat.rows.map((row) => (
          <ChatRowView key={rowKey(row)} row={row} busy={chat.busy} onRetry={chat.retry} onReload={chat.reload} />
        ))}
      </>
    );
  }

  return (
    <>
      {/*
        Ters sütun (flex-col-reverse) tek bir iç kutuyu sarar: kaydırma kendiliğinden en altta durur ve yeni parça
        gelince altta kalır; iç kutudaki sıra (eskiden yeniye) ekran okuyucu için değişmez.
      */}
      <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto">
        <div role="log" aria-label="Mesajlar" aria-busy={chat.busy} className="flex min-h-full flex-col gap-4 p-4">
          {content}
        </div>
      </div>
      <ChatComposer value={draft} onChange={setDraft} onSend={handleSend} busy={chat.busy} />
    </>
  );
}
