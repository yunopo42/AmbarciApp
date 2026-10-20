import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessTokenVerifier } from './access-token-verifier.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { SupabaseJwtVerifier } from './supabase-jwt.verifier.js';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AccessTokenVerifier,
      useFactory: (): AccessTokenVerifier => SupabaseJwtVerifier.fromProjectUrl(readSupabaseUrl()),
    },
    // Her uç nokta varsayılan olarak oturum ister; açık uç noktalar @Public() ile işaretlenir.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}

function readSupabaseUrl(): string {
  const value = process.env.SUPABASE_URL?.trim();
  if (!value) {
    // Açılışta durmak, hatayı ilk korumalı istekte değil deploy sırasında gösterir.
    throw new Error('SUPABASE_URL tanımlı değil. Yerelde .env dosyasına, Render\'da servis ortam değişkenlerine ekleyin.');
  }
  return value;
}
