import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/public.decorator.js';
import { HealthResponseDto } from './health-response.dto.js';

// Render'ın sağlık kontrolü ve web panelinin durum kartı oturumsuz çağırır.
@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Servisin ayakta olduğunu doğrular' })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return { status: 'ok' };
  }
}
