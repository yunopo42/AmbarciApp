import type { ChatStreamEvent } from '@ambarci/shared';
import type { Response } from 'express';

import type { ChatStreamSink } from './conversations.service.js';

/**
 * Akış boyunca bu aralıkla `: ping` yorum satırı gönderilir. SSE'de ":" ile başlayan satır yorumdur; istemci yok sayar.
 * Amaç, model ya da araç uzun sürdüğünde aradaki vekil sunucuların (Render'ın yük dengeleyicisi gibi) bağlantıyı boşta
 * sanıp kesmesini önlemek. Ölçüm: docs/asistan.md.
 */
export const SSE_PING_INTERVAL_MS = 15_000;

/**
 * Cevabı Server-Sent Events biçiminde yazar: her olay `event: <tür>` ve `data: <JSON>` satırları, sonra boş satır.
 * İstemci bağlantıyı kapattıysa yazma sessizce atlanır; cevap sunucuda tamamlanıp kaydedilmeye devam eder.
 */
export class SseStream implements ChatStreamSink {
  private ping: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly response: Response,
    private readonly pingIntervalMs: number = SSE_PING_INTERVAL_MS,
  ) {}

  open(): void {
    this.response.status(200);
    this.response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // Ara katmanlar cevabı önbelleğe almasın ve sıkıştırmak için biriktirmesin; nginx benzeri vekiller tamponlamasın.
    this.response.setHeader('Cache-Control', 'no-cache, no-transform');
    this.response.setHeader('X-Accel-Buffering', 'no');
    this.response.flushHeaders();
    // Kopmuş bağlantıya yazmanın hatası uygulamayı düşürmesin.
    this.response.on('error', () => undefined);
    this.ping = setInterval(() => this.write(': ping\n\n'), this.pingIntervalMs);
  }

  send(event: ChatStreamEvent): void {
    this.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  close(): void {
    clearInterval(this.ping);
    if (!this.response.writableEnded) {
      this.response.end();
    }
  }

  private write(chunk: string): void {
    if (this.response.writableEnded || this.response.destroyed) {
      return;
    }
    this.response.write(chunk);
  }
}
