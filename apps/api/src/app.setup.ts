import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Uygulama geneli ayarlar. main.ts ve testler aynı ayarla çalışsın diye tek yerde tutulur.
 */
export function configureApp(app: INestApplication): void {
  // Tüm uç noktalar /v1 altında yayınlanır.
  app.setGlobalPrefix('v1');

  const config = new DocumentBuilder()
    .setTitle('Ambarcı API')
    .setDescription('Ambarcı saha stok asistanı REST API')
    .setVersion('v1')
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
