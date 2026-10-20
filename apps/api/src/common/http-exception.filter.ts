import type { ApiError } from '@ambarci/shared';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

import { ApiException } from './api-exception.js';

// ApiException dışındaki HTTP hataları (örn. bilinmeyen adres için Nest'in 404'ü) için
// varsayılan kod ve Türkçe mesaj. Nest'in İngilizce mesajları istemciye gönderilmez.
const DEFAULT_ERRORS: Partial<Record<number, ApiError['error']>> = {
  [HttpStatus.BAD_REQUEST]: { code: 'BAD_REQUEST', message: 'İstek geçersiz.' },
  [HttpStatus.UNAUTHORIZED]: { code: 'UNAUTHORIZED', message: 'Oturum açmanız gerekiyor.' },
  [HttpStatus.FORBIDDEN]: { code: 'FORBIDDEN', message: 'Bu işlem için yetkiniz yok.' },
  [HttpStatus.NOT_FOUND]: { code: 'NOT_FOUND', message: 'Kaynak bulunamadı.' },
  [HttpStatus.CONFLICT]: { code: 'CONFLICT', message: 'İstek mevcut durumla çakışıyor.' },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Çok fazla istek gönderildi; biraz sonra tekrar deneyin.',
  },
};

const INTERNAL_ERROR: ApiError['error'] = {
  code: 'INTERNAL_ERROR',
  message: 'Beklenmeyen bir hata oluştu.',
};

/** Tüm hataları tek biçimde döner: { error: { code, message, details? } }. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    if (exception instanceof ApiException) {
      // Bilerek fırlatılan hata; 5xx ise (örn. dış servise ulaşılamadı) kodu yeterli.
      if (status >= 500) {
        this.logger.warn(`${exception.code}: ${exception.message}`);
      }
    } else if (status >= 500) {
      // Beklenmeyen hata: ayrıntı yalnızca loga yazılır, istemci genel mesajı görür.
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    response.status(status).json(body);
  }
}

function toErrorResponse(exception: unknown): { status: number; body: ApiError } {
  if (exception instanceof ApiException) {
    const error: ApiError['error'] = { code: exception.code, message: exception.message };
    if (exception.details !== undefined) {
      error.details = exception.details;
    }
    return { status: exception.getStatus(), body: { error } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const error = DEFAULT_ERRORS[status] ?? (status >= 500 ? INTERNAL_ERROR : { code: `HTTP_${status}`, message: 'İstek işlenemedi.' });
    return { status, body: { error } };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { error: INTERNAL_ERROR } };
}
