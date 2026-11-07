'use client';

import { MESSAGE_TEXT_MAX_LENGTH } from '@ambarci/shared';
import { SendHorizontal } from 'lucide-react';
import type { JSX } from 'react';

import { Button } from '@/components/ui/button';
import { controlClasses } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const CHAT_INPUT_ID = 'chat-panel-input';

/**
 * Mesaj kutusu ve "Gönder". Enter gönderir, Shift+Enter yeni satır açar; Türkçe klavyede harf birleştirilirken
 * (IME) Enter mesajı göndermez. Önceki mesajın cevabı sürerken yazılabilir ama gönderilemez.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
}): JSX.Element {
  const canSend = !busy && value.trim().length > 0;

  return (
    <form
      className="flex items-end gap-2 border-t border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) {
          onSend();
        }
      }}
    >
      <label htmlFor={CHAT_INPUT_ID} className="sr-only">
        Mesaj
      </label>
      <textarea
        id={CHAT_INPUT_ID}
        rows={1}
        value={value}
        maxLength={MESSAGE_TEXT_MAX_LENGTH}
        placeholder="Stok sor…"
        aria-describedby={`${CHAT_INPUT_ID}-hint`}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className={cn(controlClasses, 'max-h-36 resize-none py-3 field-sizing-content')}
      />
      <span id={`${CHAT_INPUT_ID}-hint`} className="sr-only">
        Enter gönderir, Shift ve Enter yeni satır açar.
      </span>
      <Button type="submit" disabled={!canSend} title={busy ? 'Önceki mesajın cevabı bekleniyor' : undefined}>
        <SendHorizontal aria-hidden />
        Gönder
      </Button>
    </form>
  );
}
