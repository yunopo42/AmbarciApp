import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { ORGANIZATION_SECURITY } from './common/openapi.js';

/**
 * Uygulama geneli ayarlar. main.ts ve testler aynı ayarla çalışsın diye tek yerde tutulur.
 */
export function configureApp(app: INestApplication): void {
  // Tüm uç noktalar /v1 altında yayınlanır.
  app.setGlobalPrefix('v1');

  // Bütün hatalar { error: { code, message, details? } } biçiminde döner.
  app.useGlobalFilters(new HttpExceptionFilter());

  // CORS yalnızca web panelinin adresine açılır. WEB_ORIGIN tanımlı değilse hiç açılmaz
  // ve tarayıcı başka bir adresten gelen istekleri engeller.
  const webOrigin = readWebOrigin();
  if (webOrigin) {
    app.enableCors({ origin: webOrigin });
  }

  SwaggerModule.setup('docs', app, () => createOpenApiDocument(app));
}

/**
 * OpenAPI belgesi: /docs sayfası ve packages/api-client'ın ürettiği istemci (pnpm gen:api) aynı belgeyi kullanır.
 *
 * Aktif şirket başlığı (X-Organization-Id) her uçta parametre olarak değil, güvenlik şeması olarak tanımlanır:
 * üretilen istemci başlığı her çağrıda istemez, tek bir ara katmanda ekler; Swagger arayüzünde de "Authorize"
 * penceresinden bir kez girilir. Başlığın değeri yine API'de kullanıcının üyeliğiyle doğrulanır.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Ambarcı API')
    .setDescription('Ambarcı saha stok asistanı REST API')
    .setVersion('v1')
    // Supabase Auth erişim token'ı: Authorization: Bearer <token>
    .addBearerAuth()
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Organization-Id',
        description: 'Aktif şirketin kimliği; API kullanıcının o şirketteki üyeliğini doğrular',
      },
      ORGANIZATION_SECURITY,
    )
    .build();
  return SwaggerModule.createDocument(app, config);
}

function readWebOrigin(): string | undefined {
  const value = process.env.WEB_ORIGIN?.trim();
  if (!value) {
    return undefined;
  }
  // Sondaki "/" veya bir yol, tarayıcının gönderdiği Origin başlığıyla eşleşmeyi bozar;
  // yalnızca şema, alan adı ve port alınır. Geçersiz bir adres açılışta hata verir.
  return new URL(value).origin;
}
