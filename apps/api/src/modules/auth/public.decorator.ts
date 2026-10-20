import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Uç noktayı oturum kontrolünden muaf tutar. Varsayılan olarak her uç nokta oturum ister. */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
