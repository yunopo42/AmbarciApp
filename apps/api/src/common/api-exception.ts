import { HttpException } from '@nestjs/common';
import type { HttpStatus } from '@nestjs/common';

/**
 * Sabit bir hata kodu taşıyan HTTP hatası. HttpExceptionFilter bunu
 * { error: { code, message, details? } } gövdesine çevirir.
 */
export class ApiException extends HttpException {
  readonly code: string;
  readonly details: unknown;

  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super(message, status);
    this.code = code;
    this.details = details;
  }
}
