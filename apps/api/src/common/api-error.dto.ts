import type { ApiError } from '@ambarci/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Swagger için sınıf karşılıkları; alanlar packages/shared içindeki apiErrorSchema ile aynı kalmak zorunda.
export class ApiErrorDetailDto {
  @ApiProperty({ example: 'AUTH_REQUIRED' })
  code!: string;

  @ApiProperty({ example: 'Oturum açmanız gerekiyor.' })
  message!: string;

  @ApiPropertyOptional()
  details?: unknown;
}

export class ApiErrorDto implements ApiError {
  @ApiProperty({ type: ApiErrorDetailDto })
  error!: ApiErrorDetailDto;
}
