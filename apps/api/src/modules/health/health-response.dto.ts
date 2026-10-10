import type { HealthResponse } from '@ambarci/shared';
import { ApiProperty } from '@nestjs/swagger';

// Swagger için sınıf karşılığı; alanlar packages/shared içindeki şemayla aynı kalmak zorunda.
export class HealthResponseDto implements HealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
}
