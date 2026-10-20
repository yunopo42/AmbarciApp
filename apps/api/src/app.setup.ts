import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { HttpExceptionFilter } from './common/http-exception.filter.js';

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

  const config = new DocumentBuilder()
    .setTitle('Ambarcı API')
    .setDescription('Ambarcı saha stok asistanı REST API')
    .setVersion('v1')
    // Supabase Auth erişim token'ı: Authorization: Bearer <token>
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
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
