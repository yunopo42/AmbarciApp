import { HttpStatus } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { ApiException } from './api-exception.js';

/**
 * İstek gövdesini packages/shared içindeki Zod şemasıyla doğrular. Geçersizse 400 VALIDATION_FAILED döner;
 * details alanında hangi alanın neden reddedildiği yer alır.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'İstek geçersiz.',
        result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      );
    }
    return result.data;
  }
}
