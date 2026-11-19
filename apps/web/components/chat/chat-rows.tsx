'use client';

import { splitBoldText, turnStatusLabel } from '@ambarci/api-client';
import type { ChatRow, SavedChatMessage } from '@ambarci/api-client';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { Fragment } from 'react';
import type { JSX } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { OperationCard } from './operation-card';

// Sohbetin satırları; mobildeki ekranla aynı yapı (apps/mobile/src/chat/chat-parts.tsx). Kullanıcının balonu primary
// zeminli, asistanın cevabı kart zeminli; ikisi de radius-lg (docs/tasarim.md). Web'de gövde metni body-md.

function UserBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="max-w-[85%] self-end whitespace-pre-wrap wrap-break-word rounded-lg bg-primary p-4 text-body-md text-on-primary">
      {text}
    </div>
  );
}

function AssistantBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex max-w-[92%] flex-col gap-1 self-start">
      <div className="flex items-center gap-2">
        <span className="text-label-lg text-primary">Ambarcı Asistan</span>
        <Badge variant="info">Yapay zeka</Badge>
      </div>
      <div className="whitespace-pre-wrap wrap-break-word rounded-lg border border-border bg-card p-4 text-body-md text-text shadow-1">
        {/* Kalın yazı tasarımdaki kalın ağırlıkla (600, body-lg-bold ile aynı). */}
        {splitBoldText(text).map((segment, index) =>
          segment.bold ? (
            <strong key={index} className="font-semibold">
              {segment.text}
            </strong>
          ) : (
            <Fragment key={index}>{segment.text}</Fragment>
          ),
        )}
      </div>
    </div>
  );
}

function StatusLine({ label }: { label: string }): JSX.Element {
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-body-md text-text-muted">
      <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin text-primary" />
      {label}
    </p>
  );
}

function FailureNote({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled: boolean }): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2">
      <Alert>{message}</Alert>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={onRetry}>
        <RotateCcw aria-hidden />
        Tekrar gönder
      </Button>
    </div>
  );
}

function SavedRow({
  message,
  note,
  busy,
  onRetry,
  onReload,
  onEditOperation,
}: {
  message: SavedChatMessage;
  note: 'failed' | 'in_progress' | null;
  busy: boolean;
  onRetry: (clientMessageId: string, text: string) => void;
  onReload: () => void;
  onEditOperation: () => void;
}): JSX.Element {
  // Turun kartları cevabın altında; cevapsız turda kullanıcının mesajının altında (#75).
  const cards = message.operationIds.map((operationId) => (
    <OperationCard key={operationId} operationId={operationId} onEdit={onEditOperation} />
  ));
  if (message.role === 'assistant') {
    return (
      <div className="flex flex-col gap-2">
        <AssistantBubble text={message.text} />
        {cards}
      </div>
    );
  }
  const clientMessageId = message.clientMessageId;
  return (
    <div className="flex flex-col gap-2">
      <UserBubble text={message.text} />
      {cards}
      {note === 'failed' && clientMessageId ? (
        <FailureNote message="Bu mesaja cevap alınamadı." disabled={busy} onRetry={() => onRetry(clientMessageId, message.text)} />
      ) : null}
      {note === 'in_progress' ? (
        <div className="flex flex-col items-start gap-2">
          <StatusLine label="Cevap hâlâ hazırlanıyor." />
          <Button variant="secondary" size="sm" onClick={onReload}>
            Yenile
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Sohbetin bir satırı: kayıtlı mesaj ya da bu panelden gönderilen mesaj ve akan cevabı. */
export function ChatRowView({
  row,
  busy,
  onRetry,
  onReload,
  onEditOperation,
}: {
  row: ChatRow;
  busy: boolean;
  onRetry: (clientMessageId: string, text: string) => void;
  onReload: () => void;
  /** Kartın "Düzenle"si: düzeltme sohbetle yapılır, mesaj kutusuna odaklanılır. */
  onEditOperation: () => void;
}): JSX.Element {
  if (row.kind === 'message') {
    return (
      <SavedRow message={row.message} note={row.note} busy={busy} onRetry={onRetry} onReload={onReload} onEditOperation={onEditOperation} />
    );
  }
  const { turn } = row;
  const status = turnStatusLabel(turn);
  return (
    <div className="flex flex-col gap-2">
      <UserBubble text={turn.text} />
      {turn.answer ? <AssistantBubble text={turn.answer} /> : null}
      {/* Kart, akışta operation_card gelince cevabın metninden önce görünür (#75). */}
      {turn.operations.map((operation) => (
        <OperationCard key={operation.operationId} operationId={operation.operationId} version={operation.version} onEdit={onEditOperation} />
      ))}
      {status ? <StatusLine label={status} /> : null}
      {turn.status === 'failed' && turn.error ? (
        <FailureNote message={turn.error.message} disabled={busy} onRetry={() => onRetry(turn.clientMessageId, turn.text)} />
      ) : null}
    </div>
  );
}

/** Yeni sohbet: ne sorulabileceği ve asistanın stoğu değiştirmediği. */
export function EmptyChat(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <p className="text-title-md text-text">Stoğu sor, asistan cevaplasın.</p>
      <p className="text-body-md text-text-muted">Örnek: &quot;Merkez depoda NYM 3x2,5 kablo kaç metre var?&quot;</p>
      <p className="text-label-md text-text-muted">
        Giriş, çıkış, transfer, sayım ya da fire için asistan bir öneri hazırlar; stok yalnızca sen kartta &quot;Onayla&quot;ya
        basınca değişir.
      </p>
    </div>
  );
}
