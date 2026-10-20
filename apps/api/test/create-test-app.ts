import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';

import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { AccessTokenVerifier } from '../src/modules/auth/access-token-verifier.js';

interface TestAppOptions {
  /** Supabase'in JWKS adresi yerine testte üretilen anahtarlarla doğrulama yapmak için. */
  accessTokenVerifier?: AccessTokenVerifier;
}

/** main.ts ile aynı ayarları taşıyan, ağ portu açmayan test uygulaması. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.accessTokenVerifier) {
    builder.overrideProvider(AccessTokenVerifier).useValue(options.accessTokenVerifier);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}
