// OpenAPI belgesini packages/api-client/openapi.json dosyasına yazar. Doğrudan değil, kök dizindeki
// "pnpm gen:api" ile çalışır: önce bu betik, sonra istemci tipleri (openapi-typescript).
//
// Uygulama oluşturulur ama porta bağlanmaz ve veritabanına bağlanmaz: postgres.js bağlantıyı ilk sorguda kurar
// ve burada hiç sorgu yoktur. Aşağıdaki değerler yalnızca modüllerin açılış kontrolleri içindir; gerçek adres
// kullanılmaz, böylece CI'da da gizli bir değer gerekmez.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { configureApp, createOpenApiDocument } from '../app.setup.js';

process.env.DATABASE_URL = 'postgresql://openapi:openapi@127.0.0.1:1/openapi';
process.env.SUPABASE_URL = 'https://openapi.invalid';
delete process.env.WEB_ORIGIN;

// Derlenmiş dosya apps/api/dist/scripts/ altında çalışır; dört üst klasör depo köküdür.
const output = fileURLToPath(new URL('../../../../packages/api-client/openapi.json', import.meta.url));

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
try {
  configureApp(app);
  const document = createOpenApiDocument(app);
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`OpenAPI belgesi yazıldı: ${Object.keys(document.paths).length} yol → packages/api-client/openapi.json`);
} finally {
  await app.close();
}
