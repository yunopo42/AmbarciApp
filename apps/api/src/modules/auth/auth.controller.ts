import type { AuthUser } from '@ambarci/shared';
import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiErrorDto } from '../../common/api-error.dto.js';
import { AuthUserDto } from './auth-user.dto.js';
import { CurrentUser } from './current-user.decorator.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Oturumdaki kullanıcıyı döner' })
  @ApiOkResponse({ type: AuthUserDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Token yok, geçersiz veya süresi dolmuş' })
  me(@CurrentUser() user: AuthUser): AuthUserDto {
    return user;
  }
}
